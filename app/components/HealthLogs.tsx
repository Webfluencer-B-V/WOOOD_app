import {
  Card,
  DataTable,
  Badge,
  Filters,
  Pagination,
  Select,
  TextField,
  Button,
  Stack,
  Heading,
  TextStyle,
  Banner,
  Modal,
  Scrollable,
  EmptyState,
  Spinner,
  DescriptionList,
  Layout
} from '@shopify/polaris';
import {
  SearchMinor,
  ExportMinor,
  FilterMajor
} from '@shopify/polaris-icons';
import { useState, useEffect, useMemo } from 'react';

interface HealthLog {
  timestamp: string;
  status: 'success' | 'error' | 'warning';
  service: string;
  message: string;
  duration?: number;
  environment: string;
  details?: any;
}

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

interface HealthLogsProps {
  healthData: HealthData;
}

export function HealthLogs({ healthData }: HealthLogsProps) {
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState<HealthLog | null>(null);

  const itemsPerPage = 20;

  // Auto-refresh health logs every 30 seconds
  useEffect(() => {
    const fetchHealthLogs = async () => {
      try {
        // For now, we'll create mock logs since the actual endpoint doesn't exist yet
        const mockLogs: HealthLog[] = [
          {
            timestamp: new Date().toISOString(),
            status: 'success',
            service: 'Health Check',
            message: 'System health check completed successfully',
            duration: 45,
            environment: healthData.environment,
          },
          {
            timestamp: new Date(Date.now() - 60000).toISOString(),
            status: 'success',
            service: 'Store Locator',
            message: 'Store locator sync completed - 150 dealers processed',
            duration: 1200,
            environment: healthData.environment,
          },
          {
            timestamp: new Date(Date.now() - 120000).toISOString(),
            status: 'success',
            service: 'Experience Center',
            message: 'Experience center sync completed - 2769 products processed',
            duration: 1800,
            environment: healthData.environment,
          },
          {
            timestamp: new Date(Date.now() - 180000).toISOString(),
            status: 'warning',
            service: 'DutchNed API',
            message: 'API response time elevated (150ms)',
            duration: 150,
            environment: healthData.environment,
          },
        ];
        setHealthLogs(mockLogs);
      } catch (error) {
        console.error('Failed to fetch health logs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHealthLogs();
    const interval = setInterval(fetchHealthLogs, 30000);

    return () => clearInterval(interval);
  }, [healthData.environment]);

  const filteredLogs = useMemo(() => {
    return healthLogs.filter(log => {
      const matchesStatus = !statusFilter || log.status === statusFilter;
      const matchesSearch = !searchValue ||
        log.message.toLowerCase().includes(searchValue.toLowerCase()) ||
        log.service.toLowerCase().includes(searchValue.toLowerCase());

      return matchesStatus && matchesSearch;
    });
  }, [healthLogs, statusFilter, searchValue]);

  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const tableRows = paginatedLogs.map((log) => [
    new Date(log.timestamp).toLocaleString(),
    <Badge status={log.status === 'error' ? 'critical' : log.status === 'warning' ? 'warning' : 'success'}>
      {log.status}
    </Badge>,
    log.service,
    log.message,
    <Button
      size="slim"
      onClick={() => {
        setSelectedLog(log);
        setShowLogModal(true);
      }}
    >
      View Details
    </Button>,
  ]);

  const exportHealthLogs = (logs: HealthLog[]) => {
    const csvContent = [
      ['Timestamp', 'Status', 'Service', 'Message', 'Duration (ms)', 'Environment'],
      ...logs.map(log => [
        new Date(log.timestamp).toISOString(),
        log.status,
        log.service,
        log.message,
        log.duration?.toString() || 'N/A',
        log.environment,
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card>
        <Card.Section>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner size="large" />
            <TextStyle variation="subdued">Loading health logs...</TextStyle>
          </div>
        </Card.Section>
      </Card>
    );
  }

  return (
    <>
      <Layout>
        <Layout.Section>
          <Card>
            <Card.Section>
              <Stack alignment="center" distribution="equalSpacing">
                <Heading>Health Logs</Heading>
                <ButtonGroup>
                  <Button
                    icon={ExportMinor}
                    onClick={() => exportHealthLogs(filteredLogs)}
                  >
                    Export Logs
                  </Button>
                  <Button onClick={() => window.location.reload()}>
                    Refresh
                  </Button>
                </ButtonGroup>
              </Stack>
            </Card.Section>

            <Card.Section>
              <Filters
                queryValue={searchValue}
                queryPlaceholder="Search logs..."
                filters={[
                  {
                    key: 'status',
                    label: 'Status',
                    filter: (
                      <Select
                        options={[
                          { label: 'All Statuses', value: '' },
                          { label: 'Success', value: 'success' },
                          { label: 'Warning', value: 'warning' },
                          { label: 'Error', value: 'error' },
                        ]}
                        value={statusFilter || ''}
                        onChange={setStatusFilter}
                      />
                    ),
                  },
                ]}
                onQueryChange={setSearchValue}
                onQueryClear={() => setSearchValue('')}
                onClearAll={() => {
                  setSearchValue('');
                  setStatusFilter('');
                }}
              />
            </Card.Section>

            {filteredLogs.length === 0 ? (
              <Card.Section>
                <EmptyState
                  heading="No health logs found"
                  image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                >
                  <p>No logs match your current filters.</p>
                </EmptyState>
              </Card.Section>
            ) : (
              <>
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Timestamp', 'Status', 'Service', 'Message', 'Actions']}
                  rows={tableRows}
                  sortable={[true, false, true, false, false]}
                  defaultSortDirection="descending"
                  initialSortColumnIndex={0}
                />

                {filteredLogs.length > itemsPerPage && (
                  <Card.Section>
                    <Stack alignment="center">
                      <Pagination
                        hasNext={currentPage * itemsPerPage < filteredLogs.length}
                        hasPrevious={currentPage > 1}
                        onNext={() => setCurrentPage(prev => prev + 1)}
                        onPrevious={() => setCurrentPage(prev => prev - 1)}
                      />
                      <TextStyle variation="subdued">
                        Page {currentPage} of {Math.ceil(filteredLogs.length / itemsPerPage)}
                      </TextStyle>
                    </Stack>
                  </Card.Section>
                )}
              </>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {selectedLog && (
        <Modal
          open={showLogModal}
          onClose={() => setShowLogModal(false)}
          title="Log Details"
          primaryAction={{
            content: 'Close',
            onAction: () => setShowLogModal(false),
          }}
        >
          <Modal.Section>
            <Scrollable style={{height: '400px'}}>
              <Stack vertical spacing="loose">
                <DescriptionList
                  items={[
                    { term: 'Timestamp', description: new Date(selectedLog.timestamp).toLocaleString() },
                    { term: 'Status', description: selectedLog.status },
                    { term: 'Service', description: selectedLog.service },
                    { term: 'Message', description: selectedLog.message },
                    { term: 'Duration', description: selectedLog.duration ? `${selectedLog.duration}ms` : 'N/A' },
                    { term: 'Environment', description: selectedLog.environment },
                  ]}
                />
                
                {selectedLog.details && (
                  <>
                    <Heading element="h4">Additional Details</Heading>
                    <pre style={{ 
                      backgroundColor: '#f6f6f7', 
                      padding: '1rem', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      overflow: 'auto'
                    }}>
                      {JSON.stringify(selectedLog.details, null, 2)}
                    </pre>
                  </>
                )}
              </Stack>
            </Scrollable>
          </Modal.Section>
        </Modal>
      )}
    </>
  );
} 