import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.parthg.geonaut',
  appName: 'Geonaut',
  webDir: 'dist',
  backgroundColor: '#070d1c',
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#070d1c', showSpinner: false, androidScaleType: 'CENTER_INSIDE' },
    LocalNotifications: { smallIcon: 'ic_stat_geonaut', iconColor: '#ffb547' },
  },
};

export default config;
