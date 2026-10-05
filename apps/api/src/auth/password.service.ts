import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

export const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$NFu8S3P3BA2tLks6X1Cf1w$lQoUUUw6nBobIqNx+8s+qtvvuCqBjcHefLTYHrXlAhs';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
