import { useLoaderData } from '@remix-run/react';
import { authenticate } from '~/shopify.server';
import {
  Page,
  Layout,
  Card,
  Tabs
} from '@shopify/polaris';
import { useState } from 'react';
import { SystemOverview } from '~/components/SystemOverview';
import { HealthLogs } from '~/components/HealthLogs';
import { ExtensionsStatus } from '~/components/ExtensionsStatus';
import { ExternalIntegrations } from '~/components/ExternalIntegrations';

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Fetch health data from Workers API
  const healthResponse = await fetch(`${process.env.WORKERS_API_URL}/health`);
  const healthData = await healthResponse.json();
  
  return json({ shop: session.shop, healthData });
}

export default function DashboardPage() {
  const { shop, healthData } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [
    { id: 'overview', content: 'System Overview' },
    { id: 'health', content: 'Health Logs' },
    { id: 'extensions', content: 'Extensions Status' },
    { id: 'integrations', content: 'External Integrations' },
  ];

  return (
    <Page
      title="WOOOD Dashboard"
      subtitle="Real-time system monitoring and configuration"
      primaryAction={{
        content: 'Refresh Status',
        onAction: () => window.location.reload(),
      }}
      secondaryActions={[
        {
          content: 'View API Docs',
          onAction: () => window.open('/docs/API.md', '_blank'),
        },
        {
          content: 'Support',
          onAction: () => window.open('mailto:support@woood.com', '_blank'),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab}>
              <Card.Section>
                {activeTab === 0 && <SystemOverview healthData={healthData} shop={shop} />}
                {activeTab === 1 && <HealthLogs healthData={healthData} />}
                {activeTab === 2 && <ExtensionsStatus healthData={healthData} />}
                {activeTab === 3 && <ExternalIntegrations healthData={healthData} />}
              </Card.Section>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 