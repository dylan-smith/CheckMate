import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      ".cache/**",
      "public/**",
      "dist/**",
    ],
  },
];

export default eslintConfig;
