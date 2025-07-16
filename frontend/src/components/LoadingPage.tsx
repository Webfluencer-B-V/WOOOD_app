import { useEffect } from 'react';
import { Page, Card, Spinner, Layout } from '@shopify/polaris';

interface LoadingPageProps {
  onReady: () => void;
}

export function LoadingPage({ onReady }: LoadingPageProps) {
  useEffect(() => {
    // Simulate App Bridge initialization
    const timer = setTimeout(() => {
      onReady();
    }, 1000);

    return () => clearTimeout(timer);
  }, [onReady]);

  return (
    <Page title="Loading WOOOD App">
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '200px',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <Spinner size="large" />
              <p>Initializing WOOOD Delivery Date Management...</p>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 