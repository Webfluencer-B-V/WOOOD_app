import React, { useState, useCallback } from 'react';
import {
  Card,
  Layout,
  Text,
  Button,
  TextField,
  Select,
  DataTable,
  Banner,
  BlockStack,
  InlineStack,
  Modal,
  Form,
  FormLayout,
  Badge,
  Box,
  Divider
} from '@shopify/polaris';
import { PlusIcon, EditIcon, DeleteIcon } from '@shopify/polaris-icons';

interface DealerLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  services?: string[];
}

interface StoreLocatorData {
  dealers: DealerLocation[];
  lastUpdated: string;
  status: 'success' | 'error' | 'running';
}

interface StoreLocatorManagerProps {
  data: StoreLocatorData;
  onSave: (dealers: DealerLocation[]) => Promise<void>;
  onRefresh: () => void;
  isLoading?: boolean;
}

const COUNTRY_OPTIONS = [
  { label: 'Netherlands', value: 'NL' },
  { label: 'Belgium', value: 'BE' },
  { label: 'Germany', value: 'DE' },
  { label: 'France', value: 'FR' },
];

const DEFAULT_SERVICES = [
  'Showroom',
  'Delivery',
  'Installation',
  'Consultation',
  'Returns',
  'Warranty Service'
];

export const StoreLocatorManager: React.FC<StoreLocatorManagerProps> = ({
  data,
  onSave,
  onRefresh,
  isLoading = false
}) => {
  const triggerSync = useCallback(async () => {
    try {
      const fd = new FormData();
      fd.set('intent', 'trigger_store_locator');
      const res = await fetch('/app', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Trigger failed');
      onRefresh();
    } catch (e) {
      console.error('Trigger Store Locator failed', e);
    }
  }, [onRefresh]);
  const [modalActive, setModalActive] = useState(false);
  const [editingDealer, setEditingDealer] = useState<DealerLocation | null>(null);
  const [formData, setFormData] = useState<Partial<DealerLocation>>({});
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleModalClose = useCallback(() => {
    setModalActive(false);
    setEditingDealer(null);
    setFormData({});
    setSelectedServices([]);
  }, []);

  const handleEdit = useCallback((dealer: DealerLocation) => {
    setEditingDealer(dealer);
    setFormData(dealer);
    setSelectedServices(dealer.services || []);
    setModalActive(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEditingDealer(null);
    setFormData({
      name: '',
      address: '',
      city: '',
      postalCode: '',
      country: 'NL',
      phone: '',
      email: '',
      website: '',
    });
    setSelectedServices([]);
    setModalActive(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formData.name || !formData.address || !formData.city || !formData.postalCode) {
      return; // Form validation would go here
    }

    setIsSaving(true);
    try {
      const newDealer: DealerLocation = {
        id: editingDealer?.id || `dealer_${Date.now()}`,
        name: formData.name!,
        address: formData.address!,
        city: formData.city!,
        postalCode: formData.postalCode!,
        country: formData.country || 'NL',
        phone: formData.phone,
        email: formData.email,
        website: formData.website,
        latitude: formData.latitude,
        longitude: formData.longitude,
        services: selectedServices.length > 0 ? selectedServices : undefined,
      };

      const updatedDealers = editingDealer
        ? data.dealers.map(d => d.id === editingDealer.id ? newDealer : d)
        : [...data.dealers, newDealer];

      await onSave(updatedDealers);
      handleModalClose();
    } catch (error) {
      console.error('Failed to save dealer:', error);
    } finally {
      setIsSaving(false);
    }
  }, [formData, selectedServices, editingDealer, data.dealers, onSave, handleModalClose]);

  const handleDelete = useCallback(async (dealerId: string) => {
    setIsSaving(true);
    try {
      const updatedDealers = data.dealers.filter(d => d.id !== dealerId);
      await onSave(updatedDealers);
    } catch (error) {
      console.error('Failed to delete dealer:', error);
    } finally {
      setIsSaving(false);
    }
  }, [data.dealers, onSave]);

  const handleServiceToggle = useCallback((service: string) => {
    setSelectedServices(prev => 
      prev.includes(service) 
        ? prev.filter(s => s !== service)
        : [...prev, service]
    );
  }, []);

  const tableRows = data.dealers.map(dealer => [
    dealer.name,
    dealer.city,
    dealer.country,
    dealer.phone || '—',
    dealer.services?.length ? (
      <InlineStack gap="100" key={dealer.id}>
        {dealer.services.slice(0, 2).map(service => (
          <Badge key={service} tone="info" size="small">{service}</Badge>
        ))}
        {dealer.services.length > 2 && (
          <Badge tone="subdued" size="small">+{dealer.services.length - 2}</Badge>
        )}
      </InlineStack>
    ) : '—',
    (
      <InlineStack gap="200" key={dealer.id}>
        <Button
          icon={EditIcon}
          size="micro"
          onClick={() => handleEdit(dealer)}
          accessibilityLabel={`Edit ${dealer.name}`}
        />
        <Button
          icon={DeleteIcon}
          size="micro"
          tone="critical"
          onClick={() => handleDelete(dealer.id)}
          accessibilityLabel={`Delete ${dealer.name}`}
        />
      </InlineStack>
    ),
  ]);

  return (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {/* Header */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Store Locator Management
                </Text>
                <InlineStack gap="200">
                  <Button onClick={onRefresh} loading={isLoading}>
                    Refresh
                  </Button>
                  <Button onClick={triggerSync} variant="primary">
                    Trigger Sync
                  </Button>
                  <Button 
                    variant="primary" 
                    icon={PlusIcon}
                    onClick={handleAdd}
                  >
                    Add Store
                  </Button>
                </InlineStack>
              </InlineStack>
              
              <InlineStack gap="400" align="start">
                <Box>
                  <Text variant="bodyMd" tone="subdued">Status:</Text>
                  <Badge tone={data.status === 'success' ? 'success' : 'critical'}>
                    {data.status}
                  </Badge>
                </Box>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Total Stores:</Text>
                  <Text variant="bodyMd" as="span">{data.dealers.length}</Text>
                </Box>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Last Updated:</Text>
                  <Text variant="bodyMd" as="span">{new Date(data.lastUpdated).toLocaleString()}</Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Dealers Table */}
          <Card>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
              headings={['Store Name', 'City', 'Country', 'Phone', 'Services', 'Actions']}
              rows={tableRows}
              footerContent={`${data.dealers.length} stores configured`}
            />
          </Card>

          {/* Quick Actions */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Quick Actions
              </Text>
              <InlineStack gap="200">
                <Button onClick={() => {/* Import from JSON */}}>
                  Import from JSON
                </Button>
                <Button onClick={() => {/* Export to JSON */}}>
                  Export to JSON
                </Button>
                <Button onClick={() => {/* Sync with external API */}}>
                  Sync with External API
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>

      {/* Add/Edit Modal */}
      <Modal
        open={modalActive}
        onClose={handleModalClose}
        title={editingDealer ? `Edit ${editingDealer.name}` : 'Add New Store'}
        primaryAction={{
          content: 'Save',
          onAction: handleSave,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: handleModalClose,
          },
        ]}
      >
        <Modal.Section>
          <Form onSubmit={handleSave}>
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Store Name"
                  value={formData.name || ''}
                  onChange={(value) => setFormData({...formData, name: value})}
                  autoComplete="off"
                />
                <Select
                  label="Country"
                  options={COUNTRY_OPTIONS}
                  value={formData.country || 'NL'}
                  onChange={(value) => setFormData({...formData, country: value})}
                />
              </FormLayout.Group>

              <TextField
                label="Address"
                value={formData.address || ''}
                onChange={(value) => setFormData({...formData, address: value})}
                autoComplete="off"
              />

              <FormLayout.Group>
                <TextField
                  label="City"
                  value={formData.city || ''}
                  onChange={(value) => setFormData({...formData, city: value})}
                  autoComplete="off"
                />
                <TextField
                  label="Postal Code"
                  value={formData.postalCode || ''}
                  onChange={(value) => setFormData({...formData, postalCode: value})}
                  autoComplete="off"
                />
              </FormLayout.Group>

              <FormLayout.Group>
                <TextField
                  label="Phone"
                  value={formData.phone || ''}
                  onChange={(value) => setFormData({...formData, phone: value})}
                  autoComplete="off"
                />
                <TextField
                  label="Email"
                  value={formData.email || ''}
                  onChange={(value) => setFormData({...formData, email: value})}
                  autoComplete="off"
                />
              </FormLayout.Group>

              <TextField
                label="Website"
                value={formData.website || ''}
                onChange={(value) => setFormData({...formData, website: value})}
                autoComplete="off"
              />

              <FormLayout.Group>
                <TextField
                  label="Latitude"
                  type="number"
                  value={formData.latitude?.toString() || ''}
                  onChange={(value) => setFormData({...formData, latitude: value ? parseFloat(value) : undefined})}
                  autoComplete="off"
                />
                <TextField
                  label="Longitude"
                  type="number"
                  value={formData.longitude?.toString() || ''}
                  onChange={(value) => setFormData({...formData, longitude: value ? parseFloat(value) : undefined})}
                  autoComplete="off"
                />
              </FormLayout.Group>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm" as="h4">Services Offered</Text>
                <InlineStack gap="200" wrap>
                  {DEFAULT_SERVICES.map(service => (
                    <Button
                      key={service}
                      size="micro"
                      pressed={selectedServices.includes(service)}
                      onClick={() => handleServiceToggle(service)}
                    >
                      {service}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>
    </Layout>
  );
};
