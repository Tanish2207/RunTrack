import { FirebaseError } from 'firebase/app';

/**
 * Shared mapping from Firebase Auth error codes to inline field errors
 * (spec §3.1/§6: validation errors render under the relevant field, never as
 * disruptive alerts). Used by both Login (#007) and Signup (#006).
 */
export type AuthErrorField = 'name' | 'email' | 'password' | 'general';

export interface FieldError {
  field: AuthErrorField;
  message: string;
}

export function getFirebaseErrorCode(err: unknown): string | null {
  if (err instanceof FirebaseError) return err.code;
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  return null;
}

export function mapFirebaseAuthError(err: unknown): FieldError {
  const code = getFirebaseErrorCode(err);
  switch (code) {
    case 'auth/email-already-in-use':
      return { field: 'email', message: 'An account with this email already exists.' };
    case 'auth/invalid-email':
    case 'auth/invalid-credential-email':
      return { field: 'email', message: 'Enter a valid email address.' };
    case 'auth/weak-password':
      return { field: 'password', message: 'Password must be at least 6 characters.' };
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return { field: 'password', message: 'Incorrect email or password.' };
    case 'auth/network-request-failed':
      return {
        field: 'general',
        message: 'Network error — check your connection and try again.',
      };
    case 'auth/too-many-requests':
      return { field: 'general', message: 'Too many attempts. Please try again shortly.' };
    case 'auth/operation-not-allowed':
      return {
        field: 'general',
        message: 'Email/password sign-in is not enabled for this Firebase project yet.',
      };
    default:
      return { field: 'general', message: 'Something went wrong. Please try again.' };
  }
}
