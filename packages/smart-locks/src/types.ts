export interface GenerateAccessCodeInput {
  reservationId: string;
  // The driver needs to know which physical lock to target — a structurally required
  // addition beyond generateAccessCode's literal ({reservationId, startsAt, endsAt})
  // spec, since no lock hardware call can proceed without it.
  externalDeviceId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface GenerateAccessCodeResult {
  // The provider's own id for this code, needed later to call revokeAccessCode.
  accessCodeId: string;
  code: string;
}

export interface RevokeAccessCodeInput {
  accessCodeId: string;
}

export interface LockDriver {
  generateAccessCode(input: GenerateAccessCodeInput): Promise<GenerateAccessCodeResult>;
  revokeAccessCode(input: RevokeAccessCodeInput): Promise<void>;
}
