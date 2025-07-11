import React from 'react';
import {
  useMetafield,
  useCartLines,
  Text,
  BlockStack,
  Banner,
  View,
  Button
} from '@shopify/ui-extensions-react/checkout';
import { setExperienceCenterMetafields, triggerExperienceCenterUpdate } from '../services/apiClient';

/**
 * Simple test component to verify useMetafield works
 */
export function MetafieldTester() {
  const cartLines = useCartLines();

  // Test the exact metafields configured in shopify.extension.toml
  const erpMetafield = useMetafield({
    namespace: 'erp',
    key: 'levertijd'
  });

  const shippingMethodMetafield = useMetafield({
    namespace: 'custom',
    key: 'ShippingMethod2'
  });

  // Test experience center metafield
  const experienceCenterMetafield = useMetafield({
    namespace: 'woood',
    key: 'experiencecenter'
  });

  const handleSetExperienceCenter = async () => {
    if (!cartLines || cartLines.length === 0) {
      console.log('No cart lines to process');
      return;
    }

    // Extract product IDs from cart lines
    const productIds = cartLines
      .map(line => line.merchandise?.product?.id)
      .filter(id => id) as string[];

    if (productIds.length === 0) {
      console.log('No product IDs found in cart');
      return;
    }

    console.log('Setting experience center metafields for products:', productIds);
    
    try {
      const success = await setExperienceCenterMetafields(productIds);
      if (success) {
        console.log('✅ Experience center metafields set successfully');
      } else {
        console.log('❌ Failed to set experience center metafields');
      }
    } catch (error) {
      console.error('Error setting experience center metafields:', error);
    }
  };

  const handleTriggerScheduledUpdate = async () => {
    console.log('Triggering scheduled experience center update...');
    
    try {
      const success = await triggerExperienceCenterUpdate();
      if (success) {
        console.log('✅ Scheduled experience center update triggered successfully');
      } else {
        console.log('❌ Failed to trigger scheduled experience center update');
      }
    } catch (error) {
      console.error('Error triggering scheduled experience center update:', error);
    }
  };

  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="tight">
        <Text emphasis="bold">🧪 Metafield Test Results</Text>

        <Banner status="info">
          <BlockStack spacing="tight">
            <Text size="small">Cart lines: {cartLines?.length || 0}</Text>
            <Text size="small">ERP metafield: {erpMetafield ? JSON.stringify(erpMetafield) : 'null'}</Text>
            <Text size="small">Shipping metafield: {shippingMethodMetafield ? JSON.stringify(shippingMethodMetafield) : 'null'}</Text>
            <Text size="small">Experience Center metafield: {experienceCenterMetafield ? JSON.stringify(experienceCenterMetafield) : 'null'}</Text>
          </BlockStack>
        </Banner>

        {cartLines && cartLines.length > 0 && (
          <Banner status="info">
            <BlockStack spacing="tight">
              <Text size="small" emphasis="bold">Cart Products:</Text>
              {cartLines.map((line, index) => {
                const product = line.merchandise?.product;
                const productId = product?.id?.replace('gid://shopify/Product/', '') || 'unknown';
                return (
                  <Text key={index} size="small">
                    Line {index}: Product {productId} - {(product as any)?.title || 'Unknown'}
                  </Text>
                );
              })}
            </BlockStack>
          </Banner>
        )}

        {/* Experience Center Test Section */}
        <Banner status="info">
          <BlockStack spacing="tight">
            <Text size="small" emphasis="bold">🏪 Experience Center Test:</Text>
            <Text size="small">Click the button below to set experience center metafields for all products in cart based on external API data.</Text>
            <Button onPress={handleSetExperienceCenter}>
              Set Experience Center Metafields
            </Button>
          </BlockStack>
        </Banner>

        {/* Scheduled Update Test Section */}
        <Banner status="info">
          <BlockStack spacing="tight">
            <Text size="small" emphasis="bold">⏰ Scheduled Update Test:</Text>
            <Text size="small">Click the button below to manually trigger the scheduled experience center update for all shops and all products (same as daily cron job).</Text>
            <Button onPress={handleTriggerScheduledUpdate}>
              Trigger Scheduled Update
            </Button>
          </BlockStack>
        </Banner>
      </BlockStack>
    </View>
  );
}