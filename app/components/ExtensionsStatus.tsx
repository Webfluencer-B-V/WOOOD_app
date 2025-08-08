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
  Collapsible,
  Link,
  Layout
} from '@shopify/polaris';
import {
  CheckIcon,
  AlertTriangleIcon,
  SettingsIcon,
  PlayIcon,
  PauseIcon
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

interface ExtensionsStatusProps {
  healthData: HealthData;
}

export function ExtensionsStatus({ healthData }: ExtensionsStatusProps) {
  const [showSettings, setShowSettings] = useState(false);

  const extensionStatus = {
    datePicker: {
      status: 'active',
      lastActivity: new Date().toISOString(),
      settings: {
        extensionMode: 'Full',
        deliveryMethodCutoff: 30,
        datePickerFiltering: 'ERP Filtered',
        hidePickerWithinDays: 14,
        maxDatesToShow: 15,
        activeCountryCodes: 'NL',
        enableMockMode: false,
        previewMode: false,
      }
    },
    shippingMethod: {
      status: 'active',
      lastActivity: new Date().toISOString(),
      settings: {
        // Shipping method extension settings
      }
    }
  };

  return (
    <Layout>
      <Layout.Section>
        <Card>
          <Card.Section>
            <Stack alignment="center" distribution="equalSpacing">
              <Heading>Extensions Status</Heading>
              <ButtonGroup>
                <Button
                  icon={SettingsIcon}
                  onClick={() => setShowSettings(!showSettings)}
                >
                  {showSettings ? 'Hide' : 'Show'} Settings
                </Button>
                <Button
                  icon={PlayIcon}
                  onClick={() => window.open('/extensions/date-picker', '_blank')}
                >
                  View Extension
                </Button>
              </ButtonGroup>
            </Stack>
          </Card.Section>

          <Card.Section>
            <Layout>
              <Layout.Section oneHalf>
                <Stack vertical spacing="tight">
                  <Heading element="h4">Date Picker Extension</Heading>
                  <Stack alignment="center" spacing="tight">
                    <Badge status="success">
                      <Stack spacing="extraTight" alignment="center">
                        <Icon source={CheckIcon} />
                        <span>Active</span>
                      </Stack>
                    </Badge>
                    <TextStyle variation="subdued">
                      Last activity: {new Date(extensionStatus.datePicker.lastActivity).toLocaleString()}
                    </TextStyle>
                  </Stack>
                </Stack>
              </Layout.Section>

              <Layout.Section oneHalf>
                <Stack vertical spacing="tight">
                  <Heading element="h4">Shipping Method Extension</Heading>
                  <Stack alignment="center" spacing="tight">
                    <Badge status="success">
                      <Stack spacing="extraTight" alignment="center">
                        <Icon source={CheckIcon} />
                        <span>Active</span>
                      </Stack>
                    </Badge>
                    <TextStyle variation="subdued">
                      Last activity: {new Date(extensionStatus.shippingMethod.lastActivity).toLocaleString()}
                    </TextStyle>
                  </Stack>
                </Stack>
              </Layout.Section>
            </Layout>
          </Card.Section>

          <Collapsible
            open={showSettings}
            id="extension-settings"
            transition={{duration: '200ms', timingFunction: 'ease-in-out'}}
          >
            <Card.Section>
              <Stack vertical spacing="loose">
                <Heading element="h4">Extension Configuration</Heading>

                <DescriptionList
                  items={[
                    {
                      term: 'Extension Mode',
                      description: extensionStatus.datePicker.settings.extensionMode,
                    },
                    {
                      term: 'Delivery Method Cutoff',
                      description: extensionStatus.datePicker.settings.deliveryMethodCutoff.toString(),
                    },
                    {
                      term: 'Date Picker Filtering',
                      description: extensionStatus.datePicker.settings.datePickerFiltering,
                    },
                    {
                      term: 'Hide Picker Within Days',
                      description: extensionStatus.datePicker.settings.hidePickerWithinDays.toString(),
                    },
                    {
                      term: 'Max Dates to Show',
                      description: extensionStatus.datePicker.settings.maxDatesToShow.toString(),
                    },
                    {
                      term: 'Active Country Codes',
                      description: extensionStatus.datePicker.settings.activeCountryCodes,
                    },
                    {
                      term: 'Enable Mock Mode',
                      description: extensionStatus.datePicker.settings.enableMockMode ? 'Yes' : 'No',
                    },
                    {
                      term: 'Preview Mode',
                      description: extensionStatus.datePicker.settings.previewMode ? 'Yes' : 'No',
                    },
                  ]}
                />

                <Banner status="info">
                  <p>
                    Extension settings are configured in the Shopify admin under Apps → WOOOD → Extensions.
                    Changes to settings require redeployment of the extension.
                  </p>
                </Banner>
              </Stack>
            </Card.Section>
          </Collapsible>
        </Card>
      </Layout.Section>

      {/* Extension Performance */}
      <Layout.Section>
        <Card title="Extension Performance">
          <Card.Section>
            <Layout>
              <Layout.Section oneThird>
                <Card sectioned>
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      &lt;50ms
                    </DisplayText>
                    <TextStyle variation="subdued">Response Time</TextStyle>
                  </Stack>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      99.99%
                    </DisplayText>
                    <TextStyle variation="subdued">Uptime</TextStyle>
                  </Stack>
                </Card>
              </Layout.Section>

              <Layout.Section oneThird>
                <Card sectioned>
                  <Stack vertical spacing="extraTight" alignment="center">
                    <DisplayText size="medium">
                      2/2
                    </DisplayText>
                    <TextStyle variation="subdued">Active Extensions</TextStyle>
                  </Stack>
                </Card>
              </Layout.Section>
            </Layout>
          </Card.Section>
        </Card>
      </Layout.Section>

      {/* Extension Documentation */}
      <Layout.Section>
        <Card title="Extension Documentation">
          <Card.Section>
            <Stack vertical spacing="tight">
              <Link url="/docs/API.md" external>
                API Reference
              </Link>
              <Link url="/docs/ARCHITECTURE.md" external>
                System Architecture
              </Link>
              <Link url="/docs/CHANGELOG.md" external>
                Development History
              </Link>
              <Link url="https://shopify.dev/docs/api/checkout-ui-extensions" external>
                Shopify Extension Documentation
              </Link>
            </Stack>
          </Card.Section>
        </Card>
      </Layout.Section>
    </Layout>
  );
}