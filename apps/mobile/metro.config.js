// Metro needs to be told about the monorepo: workspace packages live outside
// the app directory and their dependencies resolve from the root node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Workspace packages import each other with explicit .ts extensions so Node can
// run them without a build step; Metro has to be willing to resolve those.
config.resolver.sourceExts = [...config.resolver.sourceExts, "ts", "tsx"];

// Two copies of React is the classic monorepo hook-crash. Pin it.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
