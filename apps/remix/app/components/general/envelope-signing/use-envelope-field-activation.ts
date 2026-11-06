import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { useOptionalSession } from '@documenso/lib/client-only/providers/session';
import { DIRECT_TEMPLATE_RECIPIENT_EMAIL } from '@documenso/lib/constants/direct-templates';
import { isBase64Image } from '@documenso/lib/constants/signatures';
import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import { ZFullFieldSchema } from '@documenso/lib/types/field';
import { extractFullInitials } from '@documenso/lib/utils/recipient-formatter';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { useLingui } from '@lingui/react/macro';
import { type Field, FieldType, RecipientRole } from '@prisma/client';
import { useEffect, useRef } from 'react';
import { match } from 'ts-pattern';

import { useEmbedSigningContext } from '~/components/embed/embed-signing-context';
import { handleCheckboxFieldClick } from '~/utils/field-signing/checkbox-field';
import { handleDropdownFieldClick } from '~/utils/field-signing/dropdown-field';
import { handleEmailFieldClick } from '~/utils/field-signing/email-field';
import { handleInitialsFieldClick } from '~/utils/field-signing/initial-field';
import { handleNameFieldClick } from '~/utils/field-signing/name-field';
import { handleNumberFieldClick } from '~/utils/field-signing/number-field';
import { handleSignatureFieldClick } from '~/utils/field-signing/signature-field';
import { handleTextFieldClick } from '~/utils/field-signing/text-field';

import { useRequiredDocumentSigningAuthContext } from '../document-signing/document-signing-auth-provider';
import { useRequiredEnvelopeSigningContext } from '../document-signing/envelope-signing-provider';

export type ActivateEnvelopeFieldOptions = {
  field: Field;
  /**
   * The checkbox or radio option that was chosen. Ignored for other field types.
   */
  optionIndex?: number;
  onSigningStart?: () => void;
  onSigningEnd?: () => void;
};

/**
 * Runs the same fill/clear flow as tapping a field on the PDF, so it can also be
 * triggered from controls outside the Konva canvas (the mobile field stepper).
 *
 * The returned function is stable and always reads the latest signing state, because
 * the canvas binds it once per field render.
 */
export const useEnvelopeFieldActivation = () => {
  const { t } = useLingui();
  const { sessionData } = useOptionalSession();
  const { executeActionAuthProcedure } = useRequiredDocumentSigningAuthContext();
  const { toast } = useToast();
  const analytics = useAnalytics();

  const signingContext = useRequiredEnvelopeSigningContext();
  const embedSigningContext = useEmbedSigningContext();

  const latest = useRef({ signingContext, embedSigningContext, sessionData, executeActionAuthProcedure });

  useEffect(() => {
    latest.current = { signingContext, embedSigningContext, sessionData, executeActionAuthProcedure };
  });

  const signField = async (fieldId: number, payload: TSignEnvelopeFieldValue, authOptions?: TRecipientActionAuth) => {
    const { signingContext, embedSigningContext } = latest.current;
    const { onFieldSigned, onFieldUnsigned } = embedSigningContext || {};

    try {
      const { inserted } = await signingContext.signField(fieldId, payload, authOptions);

      // ?: The two callbacks below are used within the embedding context
      if (inserted && onFieldSigned) {
        const value = payload.value ? JSON.stringify(payload.value) : undefined;
        const isBase64 = value ? isBase64Image(value) : undefined;

        onFieldSigned({ fieldId, value, isBase64 });
      }

      if (!inserted && onFieldUnsigned) {
        onFieldUnsigned({ fieldId });
      }
    } catch (err) {
      console.error(err);

      analytics.captureException(err, {
        source: 'signing',
        location: 'sign_field',
        fieldType: payload.type,
        recipientId: signingContext.recipient.id,
        envelopeId: signingContext.envelope.id,
      });

      toast({
        title: t`Error`,
        description: t`An error occurred while signing the field.`,
        variant: 'destructive',
      });

      throw err;
    }
  };

  const activate = ({
    field: unparsedField,
    optionIndex,
    onSigningStart,
    onSigningEnd,
  }: ActivateEnvelopeFieldOptions) => {
    const { signingContext, sessionData, executeActionAuthProcedure } = latest.current;
    const { onSignatureChanged } = latest.current.embedSigningContext || {};

    const {
      recipient,
      isDirectTemplate,
      selectedAssistantRecipient,
      email,
      fullName,
      signature,
      setEmail,
      setFullName,
      setSignature,
      envelope,
    } = signingContext;

    const start = () => onSigningStart?.();
    const end = () => onSigningEnd?.();

    let localEmail: string | null = email;
    let localFullName: string | null = fullName;
    let placeholderEmail: string | null = null;

    if (recipient.role === RecipientRole.ASSISTANT) {
      localEmail = selectedAssistantRecipient?.email || null;
      localFullName = selectedAssistantRecipient?.name || null;
    }

    // Allows us let the user set a different email than their current logged in email.
    if (isDirectTemplate) {
      placeholderEmail = sessionData?.user?.email || email || recipient.email;

      if (!placeholderEmail || placeholderEmail === DIRECT_TEMPLATE_RECIPIENT_EMAIL) {
        placeholderEmail = null;
      }
    }

    const parsedField = ZFullFieldSchema.parse(unparsedField);

    match(parsedField)
      .with({ type: FieldType.CHECKBOX }, (field) => {
        const clickedCheckboxIndex = Number(optionIndex);

        if (Number.isNaN(clickedCheckboxIndex)) {
          return;
        }

        void handleCheckboxFieldClick({ field, clickedCheckboxIndex })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.RADIO }, (field) => {
        const selectedRadioIndex = Number(optionIndex);
        const fieldCustomText = Number(field.customText);

        if (Number.isNaN(selectedRadioIndex)) {
          return;
        }

        start();

        // Uncheck the value if it's already pressed.
        const value = field.inserted && selectedRadioIndex === fieldCustomText ? null : selectedRadioIndex;

        void signField(field.id, {
          type: FieldType.RADIO,
          value,
        }).finally(end);
      })
      .with({ type: FieldType.NUMBER }, (field) => {
        void handleNumberFieldClick({ field, number: null })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.TEXT }, (field) => {
        void handleTextFieldClick({ field, text: null })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.EMAIL }, (field) => {
        void handleEmailFieldClick({ field, email: localEmail, placeholderEmail })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }

            if (payload?.value) {
              setEmail(payload.value);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.INITIALS }, (field) => {
        const initials = localFullName ? extractFullInitials(localFullName) : null;

        void handleInitialsFieldClick({ field, initials })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.NAME }, (field) => {
        void handleNameFieldClick({ field, name: localFullName })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }

            if (payload?.value) {
              setFullName(payload.value);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.DROPDOWN }, (field) => {
        void handleDropdownFieldClick({ field, text: null })
          .then(async (payload) => {
            if (payload) {
              start();
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .with({ type: FieldType.DATE }, (field) => {
        start();

        void signField(field.id, {
          type: FieldType.DATE,
          value: !field.inserted,
        }).finally(end);
      })
      .with({ type: FieldType.SIGNATURE }, (field) => {
        void handleSignatureFieldClick({
          field,
          fullName,
          signature,
          typedSignatureEnabled: envelope.documentMeta.typedSignatureEnabled,
          uploadSignatureEnabled: envelope.documentMeta.uploadSignatureEnabled,
          drawSignatureEnabled: envelope.documentMeta.drawSignatureEnabled,
        })
          .then(async (payload) => {
            if (!payload) {
              return;
            }

            start();

            if (payload.value) {
              await executeActionAuthProcedure({
                onReauthFormSubmit: async (authOptions) => {
                  await signField(field.id, payload, authOptions);

                  end();
                },
                actionTarget: field.type,
              });

              setSignature(payload.value);
              onSignatureChanged?.(payload.value);
            } else {
              await signField(field.id, payload);
            }
          })
          .finally(end);
      })
      .exhaustive();
  };

  const activateRef = useRef(activate);
  activateRef.current = activate;

  const stableActivate = useRef((options: ActivateEnvelopeFieldOptions) => activateRef.current(options));

  return stableActivate.current;
};
