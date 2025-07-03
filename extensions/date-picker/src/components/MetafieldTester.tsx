import React from 'react';
import {
  useMetafield,
  useCartLines,
  Text,
  BlockStack,
  Banner,
  View
} from '@shopify/ui-extensions-react/checkout';

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

  return (
    <View border="base" cornerRadius="base" padding="base">
      <BlockStack spacing="tight">
        <Text emphasis="bold">🧪 Metafield Test Results</Text>

        <Banner status="info">
          <BlockStack spacing="tight">
            <Text size="small">Cart lines: {cartLines?.length || 0}</Text>
            <Text size="small">ERP metafield: {erpMetafield ? JSON.stringify(erpMetafield) : 'null'}</Text>
            <Text size="small">Shipping metafield: {shippingMethodMetafield ? JSON.stringify(shippingMethodMetafield) : 'null'}</Text>
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

        {!erpMetafield && !shippingMethodMetafield && (
          <Banner status="warning">
            <BlockStack spacing="tight">
              <Text size="small">⚠️ No metafields found. This could mean:</Text>
              <Text size="small">• Products don't have the configured metafields</Text>
              <Text size="small">• Metafields aren't properly configured in shopify.extension.toml</Text>
              <Text size="small">• Extension needs to be redeployed after configuration changes</Text>
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </View>
  );
}