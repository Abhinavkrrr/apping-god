// Template rendering — supports {{first_name}}, {{company}},
// {{company_brief_one_line}}, {{title}} and anything in customContext.
const Mustache = require("mustache");

// Disable HTML escaping — we use plain text + minimal HTML; escaping breaks links.
Mustache.escape = (t) => t;

function render(template, context) {
  return Mustache.render(template || "", context);
}

/**
 * Build the rendering context for a single send.
 * @param {object} contact   – row from contacts (joined with companies)
 * @param {object} company   – row from companies
 * @param {object} [extras]  – additional variables (e.g., LLM-rewritten line)
 */
function buildContext(contact, company, extras = {}) {
  return {
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
    email: contact.email,
    title: contact.title || "",
    company: company?.name || "",
    company_domain: company?.domain || "",
    company_brief_one_line:
      extras.company_brief_one_line ??
      company?.brief_one_line ??
      "",
    ...extras,
  };
}

module.exports = { render, buildContext };
