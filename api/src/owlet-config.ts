type Environment = Record<string, string | undefined>;

// Client identifiers must be supplied by a deployer with permission to use them.
// No third-party mobile application key or shared application secret is bundled.
export function owletClientConfig(env: Environment = process.env) {
  const names = [
    "OWLET_FIREBASE_API_KEY", "OWLET_AYLA_APP_ID", "OWLET_AYLA_APP_SECRET",
    "OWLET_ANDROID_PACKAGE", "OWLET_ANDROID_CERT",
  ] as const;
  if (names.some((name) => !env[name]?.trim())) return null;
  return {
    firebaseKey: env.OWLET_FIREBASE_API_KEY!.trim(),
    appId: env.OWLET_AYLA_APP_ID!.trim(),
    appSecret: env.OWLET_AYLA_APP_SECRET!.trim(),
    androidHeaders: {
      "X-Android-Package": env.OWLET_ANDROID_PACKAGE!.trim(),
      "X-Android-Cert": env.OWLET_ANDROID_CERT!.trim(),
    },
  };
}

export function owletTokenKeyConfigured(env: Environment = process.env) {
  const key = env.OWLET_TOKEN_KEY;
  return !!key && /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, "base64").length === 32;
}

export function owletIntegrationConfigured(env: Environment = process.env) {
  return owletTokenKeyConfigured(env) && owletClientConfig(env) !== null;
}

export function requireOwletClientConfig() {
  const config = owletClientConfig();
  if (!config) throw new Error("Owlet provider client configuration is missing");
  return config;
}
