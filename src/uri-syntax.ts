import { isIP } from "node:net";

// RFC 3986 Appendix A: ASCII syntax, with percent octets left uninterpreted.
// https://www.rfc-editor.org/rfc/rfc3986#appendix-A
const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const port = /^[0-9]*(?![\s\S])/u;
const futureAddress = /^[Vv][0-9A-Fa-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+(?![\s\S])/u;
const commonPunctuation = "-._~!$&'()*+,;=";

function hex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

// A scanner avoids regex-engine execution limits becoming an implicit URI size
// limit. The common set is unreserved / sub-delims / pct-encoded; extras depend
// on the component. Percent octets are checked but never decoded.
function validCharacters(value: string, extra: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || commonPunctuation.includes(value[index]!) || extra.includes(value[index]!)) continue;
    if (code !== 37 || !hex(value.charCodeAt(index + 1)) || !hex(value.charCodeAt(index + 2))) return false;
    index += 2;
  }
  return true;
}

/** Scheme recognition precedes percent decoding; encoded letters are not a scheme. */
export function hasUriScheme(value: string): boolean {
  return scheme.test(value);
}

/** Generic URI-reference syntax only: no repair, decoding, lookup or scheme policy. */
export function isUriReference(value: string): boolean {
  const hash = value.indexOf("#");
  if (hash >= 0 && !validCharacters(value.slice(hash + 1), ":@/?")) return false;
  const reference = hash < 0 ? value : value.slice(0, hash);
  const question = reference.indexOf("?");
  if (question >= 0 && !validCharacters(reference.slice(question + 1), ":@/?")) return false;
  const hierarchy = question < 0 ? reference : reference.slice(0, question);
  const prefix = scheme.exec(hierarchy)?.[0];
  let path = prefix ? hierarchy.slice(prefix.length) : hierarchy;
  if (path.startsWith("//")) {
    const slash = path.indexOf("/", 2);
    const authority = slash < 0 ? path.slice(2) : path.slice(2, slash);
    if (!validAuthority(authority)) return false;
    path = slash < 0 ? "" : path.slice(slash);
  } else if (!prefix && !path.startsWith("/")) {
    // A colon is allowed in later path segments, but not a path-noscheme head.
    const slash = path.indexOf("/");
    if ((slash < 0 ? path : path.slice(0, slash)).includes(":")) return false;
  }
  return validCharacters(path, ":@/");
}

function validAuthority(authority: string): boolean {
  const at = authority.lastIndexOf("@");
  if (at >= 0 && !validCharacters(authority.slice(0, at), ":")) return false;
  const hostPort = authority.slice(at + 1);
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close < 0) return false;
    const address = hostPort.slice(1, close), suffix = hostPort.slice(close + 1);
    if (suffix && (!suffix.startsWith(":") || !port.test(suffix.slice(1)))) return false;
    // isIP also accepts scoped addresses; RFC 3986 explicitly excludes zones.
    // https://nodejs.org/docs/latest-v22.x/api/net.html#netisipinput
    return futureAddress.test(address) || (!address.includes("%") && isIP(address) === 6);
  }
  const colon = hostPort.indexOf(":");
  if (colon >= 0 && !port.test(hostPort.slice(colon + 1))) return false;
  // IPv4-looking names that are not IPv4 literals can still be reg-names.
  // Generic syntax permits empty hosts/ports and does not bound numeric ports.
  return validCharacters(colon < 0 ? hostPort : hostPort.slice(0, colon), "");
}
