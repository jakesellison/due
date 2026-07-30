import appConfig from '../../app.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('launch experience', () => {
  it('uses one native logo splash on the app canvas', () => {
    const splashPlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );

    expect(splashPlugin).toEqual([
      'expo-splash-screen',
      {
        backgroundColor: '#0F0F12',
        image: './assets/brand/due-splash-mark.png',
        imageWidth: 150,
        resizeMode: 'contain',
      },
    ]);
  });

  it('does not render a second JavaScript launch overlay', () => {
    const rootLayout = readFileSync(path.join(__dirname, '..', '_layout.tsx'), 'utf8');

    expect(rootLayout).not.toContain('LaunchBrand');
  });
});
