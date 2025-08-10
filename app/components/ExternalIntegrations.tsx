// @ts-nocheck
import { Card, Badge, Text, Button, ButtonGroup, Layout, Link, DescriptionList } from '@shopify/polaris';
import {
  CheckIcon,
  AlertTriangleIcon,
  PlayIcon,
  ClockIcon,
  GlobeIcon
} from '@shopify/polaris-icons';
import { useState } from 'react';

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

interface ExternalIntegrationsProps {
  healthData: HealthData;
}

export function ExternalIntegrations({ healthData }: ExternalIntegrationsProps) {
  const [isTriggering, setIsTriggering] = useState<string | null>(null);

  const triggerIntegration = async (integration: string) => {
    setIsTriggering(integration);
    try {
      const response = await fetch(`/api/${integration}/trigger`, {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        // Show success message
        console.log(`${integration} sync triggered successfully`);
      } else {
        // Show error message
        console.error(`${integration} sync failed:`, result.error);
      }
    } catch (error) {
      console.error(`Failed to trigger ${integration}:`, error);
    } finally {
      setIsTriggering(null);
    }
  };

  return (
    <Layout>
      {/* Store Locator Integration */}
      <Layout.Section>
        <Card>
          <Card.Section>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <Text variant="headingMd" as="h3">Store Locator</Text>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                    {healthData.integrations.storeLocator.status === 'success' ? 'Active' : 'Error'}
                  </Badge>
                  <Text tone="subdued" as="span">
                    {healthData.integrations.storeLocator.dealersProcessed} dealers processed
                  </Text>
                </div>
              </div>

              <ButtonGroup>
                <Button
                  icon={PlayIcon}
                  loading={isTriggering === 'store-locator'}
                  onClick={() => triggerIntegration('store-locator')}
                >
                  Trigger Sync
                </Button>
                <Button
                  icon={ClockIcon}
                  onClick={() => window.open('/api/store-locator/status', '_blank')}
                >
                  View Status
                </Button>
              </ButtonGroup>
            </div>
          </Card.Section>

          <Card.Section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Text tone="subdued" as="p">
                Last run: {new Date(healthData.integrations.storeLocator.lastRun).toLocaleString()}
              </Text>
              <Text tone="subdued" as="p">
                Automatically syncs dealer data from external API to shop metafields
              </Text>
            </div>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Experience Center Integration */}
      <Layout.Section>
        <Card>
          <Card.Section>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <Text variant="headingMd" as="h3">Experience Center</Text>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                    {healthData.integrations.experienceCenter.status === 'success' ? 'Active' : 'Error'}
                  </Badge>
                  <Text tone="subdued" as="span">
                    {healthData.integrations.experienceCenter.productsProcessed} products processed
                  </Text>
                </div>
              </div>

              <ButtonGroup>
                <Button
                  icon={PlayIcon}
                  loading={isTriggering === 'experience-center'}
                  onClick={() => triggerIntegration('experience-center')}
                >
                  Trigger Sync
                </Button>
                <Button
                  icon={ClockIcon}
                  onClick={() => window.open('/api/experience-center/status', '_blank')}
                >
                  View Status
                </Button>
              </ButtonGroup>
            </div>
          </Card.Section>

          <Card.Section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Text tone="subdued" as="p">
                Last run: {new Date(healthData.integrations.experienceCenter.lastRun).toLocaleString()}
              </Text>
              <Text tone="subdued" as="p">
                Updates product experience center availability based on external API data
              </Text>
            </div>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Status Summary */}
      <Layout.Section>
        <Card title="Integration Summary">
          <Card.Section>
            <Layout>
              <Layout.Section oneThird>
                <Card sectioned>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                    <Text as="p" variant="headingSm">
                      {healthData.integrations.storeLocator.dealersProcessed}
                    </Text>
                    <Text tone="subdued" as="span">Total Dealers</Text>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                    <Text as="p" variant="headingSm">
                      {healthData.integrations.experienceCenter.productsProcessed}
                    </Text>
                    <Text tone="subdued" as="span">Products Processed</Text>
                  </div>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                    <Text as="p" variant="headingSm">
                      {healthData.integrations.storeLocator.status === 'success' &&
                       healthData.integrations.experienceCenter.status === 'success' ? '2/2' : '1/2'}
                    </Text>
                    <Text tone="subdued" as="span">Active Integrations</Text>
                  </div>
                </Card>
              </Layout.Section>
            </Layout>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Schedule */}
      <Layout.Section>
        <Card title="Integration Schedule">
          <Card.Section>
            <DescriptionList
              items={[
                {
                  term: 'Store Locator Sync',
                  description: 'Daily at 04:00 UTC',
                },
                {
                  term: 'Experience Center Sync',
                  description: 'Daily at 04:00 UTC',
                },
                {
                  term: 'Manual Triggers',
                  description: 'Available via dashboard buttons',
                },
                {
                  term: 'Error Handling',
                  description: 'Automatic retry with exponential backoff',
                },
              ]}
            />
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Health */}
      <Layout.Section>
        <Card title="Integration Health">
          <Card.Section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text tone="subdued" as="span">Store Locator</Text>
                <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                  {healthData.integrations.storeLocator.status === 'success' ? 'Healthy' : 'Error'}
                </Badge>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text tone="subdued" as="span">Experience Center</Text>
                <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                  {healthData.integrations.experienceCenter.status === 'success' ? 'Healthy' : 'Error'}
                </Badge>
              </div>
            </div>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Documentation */}
      <Layout.Section>
        <Card title="Integration Documentation">
          <Card.Section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Link url="/docs/API.md#store-locator-integration" external>
                Store Locator API Documentation
              </Link>
              <Link url="/docs/API.md#experience-center-integration" external>
                Experience Center API Documentation
              </Link>
              <Link url="/docs/ARCHITECTURE.md" external>
                System Architecture
              </Link>
              <Link url="/docs/CHANGELOG.md" external>
                Development History
              </Link>
            </div>
          </Card.Section>
        </Card>
      </Layout.Section>
    </Layout>
  );
}