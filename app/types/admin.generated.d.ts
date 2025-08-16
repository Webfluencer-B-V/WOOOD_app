/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types';

export type ShopInfoQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type ShopInfoQuery = { shop: Pick<AdminTypes.Shop, 'name' | 'myshopifyDomain'> };

export type ShopForActionQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type ShopForActionQuery = { shop: Pick<AdminTypes.Shop, 'myshopifyDomain'> };

interface GeneratedQueryTypes {
  "\n\t\t\t#graphql\n\t\t\tquery ShopInfo {\n\t\t\t\tshop {\n\t\t\t\t\tname\n\t\t\t\t\tmyshopifyDomain\n\t\t\t\t}\n\t\t\t}\n    ": {return: ShopInfoQuery, variables: ShopInfoQueryVariables},
  "\n\t\t#graphql\n\t\tquery ShopForAction {\n\t\t\tshop {\n\t\t\t\tmyshopifyDomain\n\t\t\t}\n\t\t}\n    ": {return: ShopForActionQuery, variables: ShopForActionQueryVariables},
}

interface GeneratedMutationTypes {
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
