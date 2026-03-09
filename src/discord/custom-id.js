export function parseCustomId(customId, prefix) {
  if (!customId?.startsWith(prefix)) return null;
  return customId.slice(prefix.length);
}

export function splitCustomId(customId, prefix) {
  const suffix = parseCustomId(customId, prefix);
  return suffix ? suffix.split('_') : [];
}

export function matchCustomId(customId, regex) {
  const m = customId?.match(regex);
  return m ? m.slice(1) : null;
}
