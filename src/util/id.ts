const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/**
 * Generate a random ID using the specified alphabet and length
 */
function customAlphabet(alphabet: string, length: number) {
  return () => {
    let result = "";
    for (let i = 0; i < length; i++) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
  };
}

/**
 * Generate a random ID using the default nanoid alphabet and length (21 characters)
 */
export function nanoid(length = 21): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result +=
      DEFAULT_ALPHABET[Math.floor(Math.random() * DEFAULT_ALPHABET.length)];
  }
  return result;
}

export const generateId = customAlphabet(ALPHABET, 12);
