const expoConfig = require("eslint-config-expo/flat");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  ...expoConfig,
  prettierConfig,
  {
    ignores: ["node_modules/", "assets/", ".expo/"],
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
