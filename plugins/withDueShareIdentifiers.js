const { withEntitlementsPlist, withXcodeProject } = require('@expo/config-plugins');

const APP_GROUP_IDENTIFIER = 'group.run.due.app.shareintent';
const SHARE_EXTENSION_BUNDLE_IDENTIFIER = 'run.due.app.share-extension';
const SHARE_EXTENSION_TARGET_NAME = 'ShareExtension';

/**
 * Keep the generated share-extension target in sync when `expo prebuild` is
 * run against an existing ios/ directory. expo-share-intent rewrites the
 * extension files, but currently skips build settings for a target that
 * already exists and prepends (rather than replaces) app-group entitlements.
 */
module.exports = function withDueShareIdentifiers(config) {
  config = withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults['com.apple.security.application-groups'] = [
      APP_GROUP_IDENTIFIER,
    ];
    return modConfig;
  });

  return withXcodeProject(config, (modConfig) => {
    const buildConfigurations =
      modConfig.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(buildConfigurations)) {
      const buildSettings = configuration?.buildSettings;
      const productName = buildSettings?.PRODUCT_NAME?.replaceAll('"', '');

      if (productName === SHARE_EXTENSION_TARGET_NAME) {
        buildSettings.PRODUCT_BUNDLE_IDENTIFIER =
          `"${SHARE_EXTENSION_BUNDLE_IDENTIFIER}"`;
      }
    }

    return modConfig;
  });
};
