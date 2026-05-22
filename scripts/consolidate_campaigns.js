// Consolidates the 3 seed campaigns (VC, Product, Growth) into a single
// master campaign called "Outreach". Removes the VC/Product/Growth
// classification from the user's view.
//
// Behavior:
//   - Renames "VC" to "Outreach"
//   - Archives "Product" and "Growth" campaigns (status='archived')
//   - Re-points all existing sends from archived campaigns to Outreach
//   - Clears contacts.custom_fields.campaign_tag (so no visible chips)
//
// Safe to run multiple times — idempotent.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

(async () => {
  const sb = getSupabase();
  console.log("Consolidating campaigns into one master 'Outreach'...\n");

  // 1) Rename VC → Outreach (this is our master)
  const { data: vc } = await sb.from("campaigns").select("id").eq("name", "VC").maybeSingle();
  if (vc) {
    await sb.from("campaigns").update({
      name: "Outreach",
      target_role: "Remote internship — Product Management, Founder's Office, or Strategy",
      status: "active",
    }).eq("id", vc.id);
    console.log("  ✓ Renamed VC → Outreach (active)");
  }

  // 2) Re-point sends from Product/Growth → Outreach, then archive them
  const { data: outreach } = await sb.from("campaigns").select("id").eq("name", "Outreach").single();
  for (const oldName of ["Product", "Growth"]) {
    const { data: old } = await sb.from("campaigns").select("id").eq("name", oldName).maybeSingle();
    if (!old) continue;
    const { count: movedSends } = await sb.from("sends").update({ campaign_id: outreach.id }, { count: "exact" })
      .eq("campaign_id", old.id);
    await sb.from("campaigns").update({ status: "archived" }).eq("id", old.id);
    console.log(`  ✓ Archived "${oldName}" (moved ${movedSends ?? 0} sends to Outreach)`);
  }

  // 3) Clear campaign_tag from contacts so no chips show anywhere
  const { data: tagged } = await sb.from("contacts")
    .select("id, custom_fields").not("custom_fields", "is", null);
  let cleared = 0;
  for (const c of tagged ?? []) {
    const cf = (c.custom_fields ?? {});
    if (cf.campaign_tag) {
      delete cf.campaign_tag;
      await sb.from("contacts").update({
        custom_fields: Object.keys(cf).length > 0 ? cf : null,
      }).eq("id", c.id);
      cleared++;
    }
  }
  console.log(`  ✓ Cleared campaign_tag from ${cleared} contact(s)`);

  // 4) Final state
  const { data: finalCampaigns } = await sb.from("campaigns").select("name, status").order("status");
  console.log("\nFinal campaigns:");
  finalCampaigns.forEach(c => console.log(`  • ${c.name} (${c.status})`));
})();
