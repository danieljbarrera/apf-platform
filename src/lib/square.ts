import { SquareClient, SquareEnvironment } from 'square';

export const squareClient = new SquareClient({
  token: process.env.SQUARE_TOKEN!,
  environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
});

export const squareLocationId = process.env.SQUARE_LOCATION_ID!;
