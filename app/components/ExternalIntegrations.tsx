import {
  Card,
  Stack,
  Badge,
  DisplayText,
  TextStyle,
  Heading,
  DescriptionList,
  Icon,
  Button,
  ButtonGroup,
  Banner,
  ProgressBar,
  Spinner,
  Layout,
  Link
} from '@shopify/polaris';
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
            <Stack alignment="center" distribution="equalSpacing">
              <Stack vertical spacing="tight">
                <Heading>Store Locator</Heading>
                <Stack alignment="center" spacing="tight">
                  <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                    {healthData.integrations.storeLocator.status === 'success' ? 'Active' : 'Error'}
                  </Badge>
                  <TextStyle variation="subdued">
                    {healthData.integrations.storeLocator.dealersProcessed} dealers processed
                  </TextStyle>
                </Stack>
              </Stack>

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
            </Stack>
          </Card.Section>

          <Card.Section>
            <Stack vertical spacing="tight">
              <TextStyle variation="subdued">
                Last run: {new Date(healthData.integrations.storeLocator.lastRun).toLocaleString()}
              </TextStyle>
              <TextStyle variation="subdued">
                Automatically syncs dealer data from external API to shop metafields
              </TextStyle>
            </Stack>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Experience Center Integration */}
      <Layout.Section>
        <Card>
          <Card.Section>
            <Stack alignment="center" distribution="equalSpacing">
              <Stack vertical spacing="tight">
                <Heading>Experience Center</Heading>
                <Stack alignment="center" spacing="tight">
                  <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                    {healthData.integrations.experienceCenter.status === 'success' ? 'Active' : 'Error'}
                  </Badge>
                  <TextStyle variation="subdued">
                    {healthData.integrations.experienceCenter.productsProcessed} products processed
                  </TextStyle>
                </Stack>
              </Stack>

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
            </Stack>
          </Card.Section>

          <Card.Section>
            <Stack vertical spacing="tight">
              <TextStyle variation="subdued">
                Last run: {new Date(healthData.integrations.experienceCenter.lastRun).toLocaleString()}
              </TextStyle>
              <TextStyle variation="subdued">
                Updates product experience center availability based on external API data
              </TextStyle>
            </Stack>
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
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      {healthData.integrations.storeLocator.dealersProcessed}
                    </DisplayText>
                    <TextStyle variation="subdued">Total Dealers</TextStyle>
                  </Stack>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      {healthData.integrations.experienceCenter.productsProcessed}
                    </DisplayText>
                    <TextStyle variation="subdued">Products Processed</TextStyle>
                  </Stack>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      {healthData.integrations.storeLocator.status === 'success' &&
                       healthData.integrations.experienceCenter.status === 'success' ? '2/2' : '1/2'}
                    </DisplayText>
                    <TextStyle variation="subdued">Active Integrations</TextStyle>
                  </Stack>
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
            <Stack vertical spacing="loose">
              <Stack alignment="center" distribution="equalSpacing">
                <TextStyle variation="subdued">Store Locator</TextStyle>
                <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                  {healthData.integrations.storeLocator.status === 'success' ? 'Healthy' : 'Error'}
                </Badge>
              </Stack>

              <Stack alignment="center" distribution="equalSpacing">
                <TextStyle variation="subdued">Experience Center</TextStyle>
                <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                  {healthData.integrations.experienceCenter.status === 'success' ? 'Healthy' : 'Error'}
                </Badge>
              </Stack>
            </Stack>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Documentation */}
      <Layout.Section>
        <Card title="Integration Documentation">
          <Card.Section>
            <Stack vertical spacing="tight">
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
            </Stack>
          </Card.Section>
        </Card>
      </Layout.Section>
    </Layout>
  );
}