/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages ship TypeScript source rather than a build artefact,
  // so Next has to compile them itself.
  transpilePackages: ["@ai-pos/shared", "@ai-pos/prompts"],
  typedRoutes: true,
};

export default nextConfig;
