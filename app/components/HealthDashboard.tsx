import React from 'react';
import {
  Card,
  Layout,
  Page,
  Text,
  Badge,
  DataTable,
  Box,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Divider
} from '@shopify/polaris';
import { RefreshIcon } from '@shopify/polaris-icons';

interface HealthData {
  status: string;
  timestamp: string;
  environment: string;
  services: {
    d1: string;
    kv: string;
  };
  data?: {
    deliveryCache: { totalEntries: number };
    storeLocator: {
      id: string;
      lastRun: number;
      status: string;
      dealersProcessed: number;
      errorMessage?: string;
    } | null;
    experienceCenter: {
      id: string;
      lastRun: number;
      status: string;
      productsProcessed: number;
      errorMessage?: string;
    } | null;
    products: {
      totalProducts: number;
      experienceCenterProducts: number;
    };
  };
}

interface HealthDashboardProps {
  healthData: HealthData;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusProps = (status: string) => {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'available':
      case 'success':
        return { tone: 'success' as const, children: status };
      case 'unhealthy':
      case 'unavailable':
      case 'error':
        return { tone: 'critical' as const, children: status };
      case 'running':
        return { tone: 'attention' as const, children: status };
      default:
        return { tone: 'info' as const, children: status };
    }
  };

  return <Badge {...getStatusProps(status)} />;
};

const formatLastRun = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
  return `${Math.floor(diffMins / 1440)} days ago`;
};

export const HealthDashboard: React.FC<HealthDashboardProps> = ({
  healthData,
  onRefresh,
  isRefreshing = false
}) => {
  const serviceRows = [
    ['D1 Database', <StatusBadge key="d1" status={healthData.services.d1} />],
    ['KV Storage', <StatusBadge key="kv" status={healthData.services.kv} />],
  ];

  const integrationRows = healthData.data ? [
    [
      'Store Locator',
      <StatusBadge key="store" status={healthData.data.storeLocator?.status || 'unknown'} />,
      healthData.data.storeLocator?.dealersProcessed || 0,
      healthData.data.storeLocator?.lastRun ? formatLastRun(healthData.data.storeLocator.lastRun) : 'Never'
    ],
    [
      'Experience Center',
      <StatusBadge key="exp" status={healthData.data.experienceCenter?.status || 'unknown'} />,
      healthData.data.experienceCenter?.productsProcessed || 0,
      healthData.data.experienceCenter?.lastRun ? formatLastRun(healthData.data.experienceCenter.lastRun) : 'Never'
    ],
  ] : [];

  return (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {/* Overall Status */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  System Health
                </Text>
                <Button
                  icon={RefreshIcon}
                  onClick={onRefresh}
                  loading={isRefreshing}
                  accessibilityLabel="Refresh health data"
                >
                  Refresh
                </Button>
              </InlineStack>

              <InlineStack gap="200" align="start">
                <Text variant="bodyMd" tone="subdued" as="span">Status:</Text>
                <StatusBadge status={healthData.status} />
                <Text variant="bodyMd" tone="subdued" as="span">Environment:</Text>
                <Badge tone="info">{healthData.environment}</Badge>
              </InlineStack>

              <Text variant="bodySm" tone="subdued" as="p">
                Last updated: {new Date(healthData.timestamp).toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          {/* Services Status */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Core Services
              </Text>
              <DataTable
                columnContentTypes={['text', 'text']}
                headings={['Service', 'Status']}
                rows={serviceRows}
                footerContent={`${serviceRows.length} services monitored`}
              />
            </BlockStack>
          </Card>

          {/* Data Summary */}
          {healthData.data && (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  Data Summary
                </Text>

                <Layout>
                  <Layout.Section variant="oneThird">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text variant="headingSm" tone="subdued" as="h4">Delivery Cache</Text>
                        <Text variant="heading2xl" as="p">
                          {healthData.data.deliveryCache.totalEntries}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="span">cached postal codes</Text>
                      </BlockStack>
                    </Box>
                  </Layout.Section>

                  <Layout.Section variant="oneThird">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text variant="headingSm" tone="subdued" as="h4">Total Products</Text>
                        <Text variant="heading2xl" as="p">
                          {healthData.data.products.totalProducts}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="span">in catalog</Text>
                      </BlockStack>
                    </Box>
                  </Layout.Section>

                  <Layout.Section variant="oneThird">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text variant="headingSm" tone="subdued" as="h4">Experience Center</Text>
                        <Text variant="heading2xl" as="p">
                          {healthData.data.products.experienceCenterProducts}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="span">featured products</Text>
                      </BlockStack>
                    </Box>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>
          )}

          {/* Integration Status */}
          {integrationRows.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  Integrations
                </Text>
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'text']}
                  headings={['Integration', 'Status', 'Items Processed', 'Last Run']}
                  rows={integrationRows}
                  footerContent={`${integrationRows.length} integrations active`}
                />
              </BlockStack>
            </Card>
          )}

          {/* Error Messages */}
          {healthData.data && (
            <>
              {healthData.data.storeLocator?.errorMessage && (
                <Banner tone="critical" title="Store Locator Error">
                  <Text variant="bodyMd" as="p">{healthData.data.storeLocator.errorMessage}</Text>
                </Banner>
              )}
              {healthData.data.experienceCenter?.errorMessage && (
                <Banner tone="critical" title="Experience Center Error">
                  <Text variant="bodyMd" as="p">{healthData.data.experienceCenter.errorMessage}</Text>
                </Banner>
              )}
            </>
          )}
        </BlockStack>
      </Layout.Section>
    </Layout>
  );
};
