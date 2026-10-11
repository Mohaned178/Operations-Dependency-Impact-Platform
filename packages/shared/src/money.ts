import { z } from 'zod';

export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,12})(\.\d{1,4})?$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const AmountStringSchema = z.string().regex(AMOUNT_PATTERN);
export const CurrencyCodeSchema = z.string().regex(CURRENCY_PATTERN);
export const MoneyDtoSchema = z.object({ amount: AmountStringSchema, currency: CurrencyCodeSchema });
export type MoneyDto = z.infer<typeof MoneyDtoSchema>;
