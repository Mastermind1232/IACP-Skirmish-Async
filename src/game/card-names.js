/** Strip bracket wrapper from skirmish upgrade names. */
export function stripBrackets(name) {
  if (typeof name !== 'string') return name;
  return name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name;
}

/** Compare two card names, ignoring bracket wrappers. */
export function cardNameEquals(a, b) {
  return stripBrackets(a) === stripBrackets(b);
}

/** Check if array contains card name, ignoring bracket wrappers. */
export function cardNameIncludes(arr, name) {
  if (!Array.isArray(arr)) return false;
  const bare = stripBrackets(name);
  return arr.some(entry => stripBrackets(entry) === bare);
}
