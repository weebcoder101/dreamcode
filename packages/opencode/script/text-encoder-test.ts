const enc = new TextEncoder()
console.log("TextEncoder:", enc.encoding)
const bytes = enc.encode("hello")
console.log("Encoded:", bytes.length, "bytes")
