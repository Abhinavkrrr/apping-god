// Cleans up a raw email body for readable display in the Inbox.
// Handles common noise: quoted-printable artifacts, MIME boundaries,
// reply-quote prefixes, signature separators, and trims at the "On
// <date>, X wrote:" boundary so we don't show the original outbound
// email back to ourselves.

const QUOTE_HEADER_PATTERNS = [
  /^On\s.+?\swrote:\s*$/im,
  /^On\s.+?,\s*at\s.+?,\s.+?\swrote:\s*$/im,
  /^-{2,}\s*Original\s+Message\s*-{2,}\s*$/im,
  /^From:\s.+\n(?:Sent|Date):\s.+\nTo:\s.+/im,
  /^_{10,}\s*$/im,
];

const SIGNATURE_SEPARATOR = /^-{2,}\s*$/m;

function decodeQuotedPrintable(s: string): string {
  // Soft line breaks
  return s
    .replace(/=\r?\n/g, "")
    // Hex sequences like =20, =E2=80=99
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
      try { return Buffer.from(hex, "hex").toString("utf8"); } catch { return ""; }
    });
}

export function cleanReplyBody(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // Strip CR
  text = text.replace(/\r/g, "");

  // Strip MIME boundary noise if present
  text = text.replace(/^--[A-Za-z0-9._=-]{8,}.*$/gm, "");
  text = text.replace(/^Content-(?:Type|Transfer-Encoding|Disposition):.*$/gim, "");
  text = text.replace(/^charset=.*$/gim, "");

  // Decode quoted-printable if it looks like that's the encoding
  if (/=[0-9A-F]{2}/i.test(text) || /=\n/.test(text)) {
    text = decodeQuotedPrintable(text);
  }

  // Trim at the "On <date>, X wrote:" boundary — keep only the new content
  for (const pat of QUOTE_HEADER_PATTERNS) {
    const match = text.match(pat);
    if (match && match.index !== undefined) {
      text = text.slice(0, match.index).trim();
      break;
    }
  }

  // Strip leading > quote prefixes line-by-line
  text = text
    .split("\n")
    .filter(line => !/^[\s>]*>+/.test(line))
    .join("\n");

  // Trim signature if present (common "-- " separator)
  const sigIdx = text.search(SIGNATURE_SEPARATOR);
  if (sigIdx >= 0 && sigIdx > 30) text = text.slice(0, sigIdx).trim();

  // Collapse 3+ blank lines into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
