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
  Thumbnail,
  Filters,
  ChoiceList,
  RangeSlider
} from '@shopify/polaris';
import { PlusIcon, EditIcon, DeleteIcon, ViewIcon, SearchIcon } from '@shopify/polaris-icons';

interface SimpleProduct {
  id: string;
  shopifyProductId: string;
  title: string;
  category?: string;
  price?: number;
  availability: 'in_stock' | 'out_of_stock' | 'discontinued';
  imageUrl?: string;
  isExperienceCenter: boolean;
}

interface ExperienceCenterData {
  products: SimpleProduct[];
  lastUpdated: string;
  status: 'success' | 'error' | 'running';
  totalProducts: number;
  experienceCenterProducts: number;
}

interface ExperienceCenterManagerProps {
  data: ExperienceCenterData;
  onSave: (products: SimpleProduct[]) => Promise<void>;
  onRefresh: () => void;
  onSyncShopify: () => Promise<void>;
  isLoading?: boolean;
}

const AVAILABILITY_OPTIONS = [
  { label: 'In Stock', value: 'in_stock' },
  { label: 'Out of Stock', value: 'out_of_stock' },
  { label: 'Discontinued', value: 'discontinued' },
];

const CATEGORY_OPTIONS = [
  { label: 'Furniture', value: 'furniture' },
  { label: 'Lighting', value: 'lighting' },
  { label: 'Decoration', value: 'decoration' },
  { label: 'Textiles', value: 'textiles' },
  { label: 'Kitchen', value: 'kitchen' },
  { label: 'Bathroom', value: 'bathroom' },
  { label: 'Garden', value: 'garden' },
];

export const ExperienceCenterManager: React.FC<ExperienceCenterManagerProps> = ({
  data,
  onSave,
  onRefresh,
  onSyncShopify,
  isLoading = false
}) => {
  const triggerSync = useCallback(async () => {
    try {
      const fd = new FormData();
      fd.set('intent', 'trigger_experience_center');
      const res = await fetch('/app', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Trigger failed');
      onRefresh();
    } catch (e) {
      console.error('Trigger Experience Center failed', e);
    }
  }, [onRefresh]);
  const [modalActive, setModalActive] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SimpleProduct | null>(null);
  const [formData, setFormData] = useState<Partial<SimpleProduct>>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // Filter states
  const [queryValue, setQueryValue] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);
  const [experienceCenterFilter, setExperienceCenterFilter] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);

  const handleModalClose = useCallback(() => {
    setModalActive(false);
    setEditingProduct(null);
    setFormData({});
  }, []);

  const handleEdit = useCallback((product: SimpleProduct) => {
    setEditingProduct(product);
    setFormData(product);
    setModalActive(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEditingProduct(null);
    setFormData({
      shopifyProductId: '',
      title: '',
      category: 'furniture',
      price: 0,
      availability: 'in_stock',
      imageUrl: '',
      isExperienceCenter: false,
    });
    setModalActive(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formData.shopifyProductId || !formData.title) {
      return; // Form validation would go here
    }

    setIsSaving(true);
    try {
      const newProduct: SimpleProduct = {
        id: editingProduct?.id || `product_${Date.now()}`,
        shopifyProductId: formData.shopifyProductId!,
        title: formData.title!,
        category: formData.category,
        price: formData.price,
        availability: formData.availability || 'in_stock',
        imageUrl: formData.imageUrl,
        isExperienceCenter: formData.isExperienceCenter || false,
      };

      const updatedProducts = editingProduct
        ? data.products.map(p => p.id === editingProduct.id ? newProduct : p)
        : [...data.products, newProduct];

      await onSave(updatedProducts);
      handleModalClose();
    } catch (error) {
      console.error('Failed to save product:', error);
    } finally {
      setIsSaving(false);
    }
  }, [formData, editingProduct, data.products, onSave, handleModalClose]);

  const handleToggleExperienceCenter = useCallback(async (productId: string) => {
    setIsSaving(true);
    try {
      const updatedProducts = data.products.map(p => 
        p.id === productId ? { ...p, isExperienceCenter: !p.isExperienceCenter } : p
      );
      await onSave(updatedProducts);
    } catch (error) {
      console.error('Failed to toggle experience center:', error);
    } finally {
      setIsSaving(false);
    }
  }, [data.products, onSave]);

  const handleDelete = useCallback(async (productId: string) => {
    setIsSaving(true);
    try {
      const updatedProducts = data.products.filter(p => p.id !== productId);
      await onSave(updatedProducts);
    } catch (error) {
      console.error('Failed to delete product:', error);
    } finally {
      setIsSaving(false);
    }
  }, [data.products, onSave]);

  // Filter products
  const filteredProducts = data.products.filter(product => {
    if (queryValue && !product.title.toLowerCase().includes(queryValue.toLowerCase())) {
      return false;
    }
    if (selectedCategories.length > 0 && !selectedCategories.includes(product.category || '')) {
      return false;
    }
    if (selectedAvailability.length > 0 && !selectedAvailability.includes(product.availability)) {
      return false;
    }
    if (experienceCenterFilter.includes('experience_center') && !product.isExperienceCenter) {
      return false;
    }
    if (experienceCenterFilter.includes('not_experience_center') && product.isExperienceCenter) {
      return false;
    }
    if (product.price && (product.price < priceRange[0] || product.price > priceRange[1])) {
      return false;
    }
    return true;
  });

  const tableRows = filteredProducts.map(product => [
    (
      <InlineStack gap="200" key={product.id}>
        {product.imageUrl && (
          <Thumbnail
            source={product.imageUrl}
            alt={product.title}
            size="small"
          />
        )}
        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="semibold">{product.title}</Text>
          <Text variant="bodySm" tone="subdued">ID: {product.shopifyProductId}</Text>
        </BlockStack>
      </InlineStack>
    ),
    product.category || '—',
    product.price ? `€${product.price.toFixed(2)}` : '—',
    <Badge 
      key={product.id} 
      tone={product.availability === 'in_stock' ? 'success' : product.availability === 'out_of_stock' ? 'attention' : 'critical'}
    >
      {product.availability.replace('_', ' ')}
    </Badge>,
    <Badge 
      key={`exp-${product.id}`} 
      tone={product.isExperienceCenter ? 'success' : 'subdued'}
    >
      {product.isExperienceCenter ? 'Featured' : 'Standard'}
    </Badge>,
    (
      <InlineStack gap="200" key={product.id}>
        <Button
          icon={ViewIcon}
          size="micro"
          onClick={() => handleToggleExperienceCenter(product.id)}
          accessibilityLabel={`Toggle experience center for ${product.title}`}
        >
          {product.isExperienceCenter ? 'Remove' : 'Feature'}
        </Button>
        <Button
          icon={EditIcon}
          size="micro"
          onClick={() => handleEdit(product)}
          accessibilityLabel={`Edit ${product.title}`}
        />
        <Button
          icon={DeleteIcon}
          size="micro"
          tone="critical"
          onClick={() => handleDelete(product.id)}
          accessibilityLabel={`Delete ${product.title}`}
        />
      </InlineStack>
    ),
  ]);

  const filters = [
    {
      key: 'category',
      label: 'Category',
      filter: (
        <ChoiceList
          title="Category"
          titleHidden
          choices={CATEGORY_OPTIONS}
          selected={selectedCategories}
          onChange={setSelectedCategories}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: 'availability',
      label: 'Availability',
      filter: (
        <ChoiceList
          title="Availability"
          titleHidden
          choices={AVAILABILITY_OPTIONS}
          selected={selectedAvailability}
          onChange={setSelectedAvailability}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: 'experience_center',
      label: 'Experience Center',
      filter: (
        <ChoiceList
          title="Experience Center"
          titleHidden
          choices={[
            { label: 'Featured in Experience Center', value: 'experience_center' },
            { label: 'Not in Experience Center', value: 'not_experience_center' },
          ]}
          selected={experienceCenterFilter}
          onChange={setExperienceCenterFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [
    ...selectedCategories.map(category => ({
      key: `category-${category}`,
      label: `Category: ${CATEGORY_OPTIONS.find(opt => opt.value === category)?.label}`,
      onRemove: () => setSelectedCategories(prev => prev.filter(c => c !== category)),
    })),
    ...selectedAvailability.map(availability => ({
      key: `availability-${availability}`,
      label: `Availability: ${AVAILABILITY_OPTIONS.find(opt => opt.value === availability)?.label}`,
      onRemove: () => setSelectedAvailability(prev => prev.filter(a => a !== availability)),
    })),
    ...experienceCenterFilter.map(filter => ({
      key: `exp-${filter}`,
      label: filter === 'experience_center' ? 'Featured Products' : 'Standard Products',
      onRemove: () => setExperienceCenterFilter(prev => prev.filter(f => f !== filter)),
    })),
  ];

  return (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {/* Header */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Experience Center Products
                </Text>
                <InlineStack gap="200">
                  <Button onClick={onRefresh} loading={isLoading}>
                    Refresh
                  </Button>
                  <Button onClick={triggerSync} loading={isLoading}>
                    Trigger Sync
                  </Button>
                  <Button 
                    variant="primary" 
                    icon={PlusIcon}
                    onClick={handleAdd}
                  >
                    Add Product
                  </Button>
                </InlineStack>
              </InlineStack>
              
              <Layout>
                <Layout.Section oneThird>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text variant="headingSm" tone="subdued">Total Products</Text>
                      <Text variant="heading2xl" as="p">{data.totalProducts}</Text>
                      <Text variant="bodySm" tone="subdued">in catalog</Text>
                    </BlockStack>
                  </Box>
                </Layout.Section>
                
                <Layout.Section oneThird>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text variant="headingSm" tone="subdued">Experience Center</Text>
                      <Text variant="heading2xl" as="p">{data.experienceCenterProducts}</Text>
                      <Text variant="bodySm" tone="subdued">featured products</Text>
                    </BlockStack>
                  </Box>
                </Layout.Section>
                
                <Layout.Section oneThird>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <Text variant="headingSm" tone="subdued">Status</Text>
                      <Badge tone={data.status === 'success' ? 'success' : 'critical'}>
                        {data.status}
                      </Badge>
                      <Text variant="bodySm" tone="subdued">
                        {new Date(data.lastUpdated).toLocaleString()}
                      </Text>
                    </BlockStack>
                  </Box>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>

          {/* Filters and Search */}
          <Card>
            <Filters
              queryValue={queryValue}
              filters={filters}
              appliedFilters={appliedFilters}
              onQueryChange={setQueryValue}
              onQueryClear={() => setQueryValue('')}
              onClearAll={() => {
                setQueryValue('');
                setSelectedCategories([]);
                setSelectedAvailability([]);
                setExperienceCenterFilter([]);
              }}
              queryPlaceholder="Search products..."
            />
          </Card>

          {/* Products Table */}
          <Card>
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
              headings={['Product', 'Category', 'Price', 'Availability', 'Experience Center', 'Actions']}
              rows={tableRows}
              footerContent={`${filteredProducts.length} of ${data.products.length} products`}
            />
          </Card>
        </BlockStack>
      </Layout.Section>

      {/* Add/Edit Modal */}
      <Modal
        open={modalActive}
        onClose={handleModalClose}
        title={editingProduct ? `Edit ${editingProduct.title}` : 'Add New Product'}
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
              <TextField
                label="Shopify Product ID"
                value={formData.shopifyProductId || ''}
                onChange={(value) => setFormData({...formData, shopifyProductId: value})}
                autoComplete="off"
                helpText="The product ID from Shopify"
              />

              <TextField
                label="Product Title"
                value={formData.title || ''}
                onChange={(value) => setFormData({...formData, title: value})}
                autoComplete="off"
              />

              <FormLayout.Group>
                <Select
                  label="Category"
                  options={CATEGORY_OPTIONS}
                  value={formData.category || 'furniture'}
                  onChange={(value) => setFormData({...formData, category: value})}
                />
                <Select
                  label="Availability"
                  options={AVAILABILITY_OPTIONS}
                  value={formData.availability || 'in_stock'}
                  onChange={(value) => setFormData({...formData, availability: value as any})}
                />
              </FormLayout.Group>

              <FormLayout.Group>
                <TextField
                  label="Price (EUR)"
                  type="number"
                  value={formData.price?.toString() || ''}
                  onChange={(value) => setFormData({...formData, price: value ? parseFloat(value) : undefined})}
                  autoComplete="off"
                />
                <ChoiceList
                  title="Experience Center"
                  choices={[
                    { label: 'Feature in Experience Center', value: 'true' },
                  ]}
                  selected={formData.isExperienceCenter ? ['true'] : []}
                  onChange={(selected) => setFormData({...formData, isExperienceCenter: selected.includes('true')})}
                />
              </FormLayout.Group>

              <TextField
                label="Image URL"
                value={formData.imageUrl || ''}
                onChange={(value) => setFormData({...formData, imageUrl: value})}
                autoComplete="off"
                helpText="URL to the product image"
              />
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>
    </Layout>
  );
};
