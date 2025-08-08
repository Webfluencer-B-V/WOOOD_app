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
  Layout
} from '@shopify/polaris';
import {
  CheckIcon,
  AlertTriangleIcon,
  ClockIcon,
  GlobeIcon
} from '@shopify/polaris-icons';

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
      healthy: { status: 'success', icon: CheckIcon },
      degraded: { status: 'warning', icon: AlertTriangleIcon },
      unhealthy: { status: 'critical', icon: AlertTriangleIcon },
    };

    const config = statusConfig[status] || statusConfig.unhealthy;

    return (
      <Badge status={config.status}>
        <Stack spacing="extraTight" alignment="center">
          <Icon source={config.icon} />
          <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
        </Stack>
      </Badge>
    );
  };

  return (
    <Layout>
      {/* System Status */}
      <Layout.Section>
        <Card>
          <Card.Section>
            <Stack alignment="center" distribution="equalSpacing">
              <Stack vertical spacing="tight">
                <Heading>System Status</Heading>
                {getStatusBadge(healthData.status)}
                <TextStyle variation="subdued">
                  Last updated: {new Date(healthData.timestamp).toLocaleString()}
                </TextStyle>
              </Stack>

              <ButtonGroup>
                <Button icon={ClockIcon} onClick={() => window.location.reload()}>
                  Refresh
                </Button>
                <Button icon={GlobeIcon} onClick={() => window.open('/api/health', '_blank')}>
                  View Raw
                </Button>
              </ButtonGroup>
            </Stack>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Service Status */}
      <Layout.Section>
        <Card title="Service Status">
          <Card.Section>
            <DescriptionList
              items={[
                {
                  term: 'Cloudflare KV Storage',
                  description: (
                    <Badge status={healthData.services.kv === 'available' ? 'success' : 'critical'}>
                      {healthData.services.kv === 'available' ? 'Available' : 'Unavailable'}
                    </Badge>
                  ),
                },
                {
                  term: 'DutchNed API',
                  description: (
                    <Badge status={healthData.services.dutchNedApi === 'available' ? 'success' : 'critical'}>
                      {healthData.services.dutchNedApi === 'available' ? 'Available' : 'Unavailable'}
                    </Badge>
                  ),
                },
                {
                  term: 'Shopify Admin API',
                  description: (
                    <Badge status={healthData.services.shopifyApi === 'available' ? 'success' : 'critical'}>
                      {healthData.services.shopifyApi === 'available' ? 'Available' : 'Unavailable'}
                    </Badge>
                  ),
                },
              ]}
            />
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Integration Status */}
      <Layout.Section>
        <Card title="External Integrations">
          <Card.Section>
            <Layout>
              <Layout.Section oneHalf>
                <Stack vertical spacing="tight">
                  <Heading element="h4">Store Locator</Heading>
                  <Stack alignment="center" spacing="tight">
                    <Badge status={healthData.integrations.storeLocator.status === 'success' ? 'success' : 'critical'}>
                      {healthData.integrations.storeLocator.status === 'success' ? 'Active' : 'Error'}
                    </Badge>
                    <TextStyle variation="subdued">
                      {healthData.integrations.storeLocator.dealersProcessed} dealers processed
                    </TextStyle>
                  </Stack>
                  <TextStyle variation="subdued">
                    Last run: {new Date(healthData.integrations.storeLocator.lastRun).toLocaleString()}
                  </TextStyle>
                </Stack>
              </Layout.Section>

              <Layout.Section oneHalf>
                <Stack vertical spacing="tight">
                  <Heading element="h4">Experience Center</Heading>
                  <Stack alignment="center" spacing="tight">
                    <Badge status={healthData.integrations.experienceCenter.status === 'success' ? 'success' : 'critical'}>
                      {healthData.integrations.experienceCenter.status === 'success' ? 'Active' : 'Error'}
                    </Badge>
                    <TextStyle variation="subdued">
                      {healthData.integrations.experienceCenter.productsProcessed} products processed
                    </TextStyle>
                  </Stack>
                  <TextStyle variation="subdued">
                    Last run: {new Date(healthData.integrations.experienceCenter.lastRun).toLocaleString()}
                  </TextStyle>
                </Stack>
              </Layout.Section>
            </Layout>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Quick Stats */}
      <Layout.Section>
        <Card title="Quick Statistics">
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
    </Layout>
  );
}