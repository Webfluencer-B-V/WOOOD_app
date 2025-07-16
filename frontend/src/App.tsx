import { useState, useCallback } from 'react';
import { Frame, AppProvider } from '@shopify/polaris';
import { AppContent } from './components/AppContent';
import { LoadingPage } from './components/LoadingPage';
import en from '@shopify/polaris/locales/en.json';

function App() {
  const [loading, setLoading] = useState(true);

  // Get parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop');
  // const host = urlParams.get('host');

  const handleAppReady = useCallback(() => {
    setLoading(false);
  }, []);

  return (
    <AppProvider i18n={en}>
      <Frame>
        {loading ? (
          <LoadingPage onReady={handleAppReady} />
        ) : (
          <AppContent shop={shop} />
        )}
      </Frame>
    </AppProvider>
  );
}

export default App; 