// @ts-nocheck
import { Card, Badge, DescriptionList, Button, ButtonGroup, Layout } from '@shopify/polaris';

interface HealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  environment: 'production' | 'staging' | 'development';
  services: {
    kv: 'available' | 'unavailable';
    dutchNedApi: 'available' | 'unavailable' | 'unknown';
    shopifyApi: 'available' | 'unavailable';
  };
  integrations: {
    storeLocator: {
      lastRun: string;
      status: 'success' | 'error' | 'running';
      dealersProcessed: number;
    };
    experienceCenter: {
      lastRun: string;
      status: 'success' | 'error' | 'running';
      productsProcessed: number;
    };
  };
}

interface SystemOverviewProps {
  healthData: HealthData;
  shop: string;
}

export function SystemOverview({ healthData, shop }: SystemOverviewProps) {
  const getStatusBadge = (status: string) => {
    const statusConfig = {
      healthy: { status: 'success' },
      degraded: { status: 'warning' },
      unhealthy: { status: 'critical' },
    } as const;
    const config = (statusConfig as any)[status] || statusConfig.unhealthy;
    return <Badge status={config.status}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
  };

  return (
    <Layout>
      {/* System Status */}
      <Layout.Section>
        <Card>
          <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>System Status</h2>
              <div style={{ marginTop: '0.5rem' }}>{getStatusBadge(healthData.status)}</div>
              <p style={{ color: '#6d7175', marginTop: '0.5rem' }}>
                Last updated: {new Date(healthData.timestamp).toLocaleString()}
              </p>
            </div>
            <ButtonGroup>
              <Button onClick={() => window.location.reload()}>Refresh</Button>
              <Button onClick={() => window.open('/api/health', '_blank')}>View Raw</Button>
            </ButtonGroup>
          </div>
        </Card>
      </Layout.Section>

      {/* Service Status */}
      <Layout.Section>
        <Card title="Service Status">
          <div style={{ padding: '1rem' }}>
            <DescriptionList
              items={[
                {
                  term: 'Cloudflare KV Storage',
                  description: <Badge status={healthData.services.kv === 'available' ? 'success' : 'critical'}>{healthData.services.kv === 'available' ? 'Available' : 'Unavailable'}</Badge>,
                },
                {
                  term: 'DutchNed API',
                  description: <Badge status={healthData.services.dutchNedApi === 'available' ? 'success' : 'critical'}>{healthData.services.dutchNedApi === 'available' ? 'Available' : 'Unavailable'}</Badge>,
                },
                {
                  term: 'Shopify Admin API',
                  description: <Badge status={healthData.services.shopifyApi === 'available' ? 'success' : 'critical'}>{healthData.services.shopifyApi === 'available' ? 'Available' : 'Unavailable'}</Badge>,
                },
              ]}
            />
          </div>
        </Card>
      </Layout.Section>

      {/* Integration Status */}
      <Layout.Section>
        <Card title="External Integrations">
          <div style={{ padding: '1rem' }}>
            <Layout>
              <Layout.Section oneHalf>
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0' }}>Store Locator</h3>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                      {healthData.integrations.storeLocator.status === 'success' ? 'Active' : 'Error'}
                    </Badge>
                    <span style={{ color: '#6d7175' }}>
                      {healthData.integrations.storeLocator.dealersProcessed} dealers processed
                    </span>
                  </div>
                  <p style={{ color: '#6d7175' }}>
                    Last run: {new Date(healthData.integrations.storeLocator.lastRun).toLocaleString()}
                  </p>
                </div>
              </Layout.Section>

              <Layout.Section oneHalf>
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0' }}>Experience Center</h3>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                      {healthData.integrations.experienceCenter.status === 'success' ? 'Active' : 'Error'}
                    </Badge>
                    <span style={{ color: '#6d7175' }}>
                      {healthData.integrations.experienceCenter.productsProcessed} products processed
                    </span>
                  </div>
                  <p style={{ color: '#6d7175' }}>
                    Last run: {new Date(healthData.integrations.experienceCenter.lastRun).toLocaleString()}
                  </p>
                </div>
              </Layout.Section>
            </Layout>
          </div>
        </Card>
      </Layout.Section>

      {/* Quick Stats */}
      <Layout.Section>
        <Card title="Quick Statistics">
          <div style={{ padding: '1rem' }}>
            <Layout>
              <Layout.Section oneThird>
                <Card>
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {healthData.integrations.storeLocator.dealersProcessed}
                    </div>
                    <p style={{ color: '#6d7175' }}>Total Dealers</p>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card>
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {healthData.integrations.experienceCenter.productsProcessed}
                    </div>
                    <p style={{ color: '#6d7175' }}>Products Processed</p>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card>
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {healthData.integrations.storeLocator.status === 'success' &&
                       healthData.integrations.experienceCenter.status === 'success' ? '2/2' : '1/2'}
                    </div>
                    <p style={{ color: '#6d7175' }}>Active Integrations</p>
                  </div>
                </Card>
              </Layout.Section>
            </Layout>
          </div>
        </Card>
      </Layout.Section>
    </Layout>
  );
}