import { Storage, type File } from "@google-cloud/storage";

const sidecar = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${sidecar}/token`,
    type: "external_account",
    credential_source: {
      url: `${sidecar}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateBucket() {
  const parts = (process.env.PRIVATE_OBJECT_DIR ?? "").split("/").filter(Boolean);
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  if (!bucketName || !prefix) throw new Error("Private screenshot storage is not configured.");
  return { bucketName, prefix };
}

export async function storeWebsiteScreenshot(
  companyId: number,
  variant: "desktop" | "mobile",
  bytes: Buffer,
): Promise<string> {
  const { bucketName, prefix } = privateBucket();
  const key = `${prefix}/lead-finder/${companyId}/${variant}.png`;
  await storage.bucket(bucketName).file(key).save(bytes, {
    resumable: false,
    metadata: {
      contentType: "image/png",
      cacheControl: "private, max-age=3600",
    },
  });
  return `${bucketName}/${key}`;
}

export async function getPrivateScreenshot(objectPath: string): Promise<File> {
  const { bucketName, prefix } = privateBucket();
  const [storedBucket, ...keyParts] = objectPath.split("/");
  const key = keyParts.join("/");
  if (
    storedBucket !== bucketName ||
    !key.startsWith(`${prefix}/lead-finder/`) ||
    key.includes("..")
  ) {
    throw new Error("Screenshot path is invalid.");
  }
  const file = storage.bucket(bucketName).file(key);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Screenshot not found.");
  return file;
}
