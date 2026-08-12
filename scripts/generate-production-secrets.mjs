import { randomBytes } from "node:crypto";

const secrets = {
  JWT_SECRET: token(48),
  ADMIN_TOKEN: token(48),
  OPS_TOKEN: token(48)
};

console.log("# Copy these values into /etc/Sitong-secrets/Sitong-os-v2.env on the server.");
console.log("# Do not commit real production secrets.");
console.log("");
for (const [name, value] of Object.entries(secrets)) {
  console.log(`${name}=${value}`);
}

function token(bytes) {
  return randomBytes(bytes).toString("base64url");
}
