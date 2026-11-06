import { useCurrentEnvelopeRender } from '@documenso/lib/client-only/providers/envelope-render-provider';
import { PDF_VIEWER_CONTENT_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
import { isFieldUnsignedAndRequired, isRequiredField } from '@documenso/lib/utils/advanced-fields-helpers';
import { parseCheckboxCustomText } from '@documenso/lib/utils/fields';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { type Field, FieldType } from '@prisma/client';
import { motion } from 'framer-motion';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListChecksIcon,
  PointerIcon,
  SquareCheckIcon,
  SquareIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { match } from 'ts-pattern';

import { useRequiredEnvelopeSigningContext } from '../document-signing/envelope-signing-provider';
import { EnvelopeSignerMobileFieldsSheet, getFieldLabel } from './envelope-signer-mobile-fields-sheet';
import { MOBILE_FOCUSED_FIELD_ELEMENT_ID } from './envelope-signer-page-renderer';
import { EnvelopeSignerCompleteDialog } from './envelope-signing-complete-dialog';
import { useEnvelopeFieldActivation } from './use-envelope-field-activation';

export const EnvelopeSignerMobileStepper = () => {
  const { t } = useLingui();
  const { currentEnvelopeItem, setCurrentEnvelopeItem } = useCurrentEnvelopeRender();
  const activateField = useEnvelopeFieldActivation();

  const {
    envelope,
    recipientFields,
    recipientFieldsRemaining,
    requiredRecipientFields,
    focusedFieldId,
    setFocusedFieldId,
  } = useRequiredEnvelopeSigningContext();

  const [isSigning, setIsSigning] = useState(false);
  const [isFieldsSheetOpen, setIsFieldsSheetOpen] = useState(false);
  const [hasUsedStepper, setHasUsedStepper] = useState(false);

  const steps = useMemo(
    () => getOrderedSteps(recipientFields, envelope.envelopeItems),
    [recipientFields, envelope.envelopeItems],
  );

  const focusedIndex = steps.findIndex((field) => field.id === focusedFieldId);
  const firstRemainingIndex = steps.findIndex((field) => field.id === recipientFieldsRemaining[0]?.id);

  const currentIndex = focusedIndex === -1 ? Math.max(firstRemainingIndex, 0) : focusedIndex;
  const currentField: Field | undefined = steps[currentIndex];

  const remainingRequiredCount = recipientFieldsRemaining.length;

  const progressPercent =
    requiredRecipientFields.length === 0 ? 100 : 100 - (100 / requiredRecipientFields.length) * remainingRequiredCount;

  const goToField = (field: Field) => {
    setHasUsedStepper(true);
    setFocusedFieldId(field.id);

    const isEnvelopeItemSwitch = field.envelopeItemId !== currentEnvelopeItem?.id;

    if (isEnvelopeItemSwitch) {
      setCurrentEnvelopeItem(field.envelopeItemId);
    }

    setTimeout(
      () => {
        if (scrollFocusedFieldIntoView()) {
          return;
        }

        // The field's page is virtualized away, so ask the PDF viewer to render it first.
        document.querySelector(PDF_VIEWER_CONTENT_SELECTOR)?.setAttribute('data-scroll-to-page', String(field.page));

        setTimeout(scrollFocusedFieldIntoView, 500);
      },
      isEnvelopeItemSwitch ? 150 : 50,
    );
  };

  useEffect(() => {
    if (focusedIndex === -1 && currentField) {
      setFocusedFieldId(currentField.id);
    }
  }, [focusedIndex, currentField?.id]);

  const previousInsertedState = useRef<{ id: number; inserted: boolean } | null>(null);

  useEffect(() => {
    if (!currentField) {
      return;
    }

    const previous = previousInsertedState.current;
    previousInsertedState.current = { id: currentField.id, inserted: currentField.inserted };

    const hasJustBeenFilled = previous?.id === currentField.id && !previous.inserted && currentField.inserted;

    if (!hasJustBeenFilled || isMultiOptionCheckbox(currentField)) {
      return;
    }

    const nextField = findNextUnfilledField(steps, currentIndex);

    if (nextField) {
      goToField(nextField);
    }
  }, [currentField?.id, currentField?.inserted]);

  const onActivate = (optionIndex?: number) => {
    if (!currentField || isSigning) {
      return;
    }

    setHasUsedStepper(true);

    activateField({
      field: currentField,
      optionIndex,
      onSigningStart: () => setIsSigning(true),
      onSigningEnd: () => setIsSigning(false),
    });
  };

  if (!currentField) {
    return (
      <div className="flex items-center justify-between gap-4 p-4">
        <p className="font-semibold text-foreground">
          <Trans>Review the document</Trans>
        </p>

        <div className="w-36">
          <EnvelopeSignerCompleteDialog buttonSize="lg" />
        </div>
      </div>
    );
  }

  const options = getFieldOptions(currentField);

  return (
    <div className="space-y-3 p-3">
      {!hasUsedStepper && remainingRequiredCount > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-foreground text-sm">
          <PointerIcon className="h-4 w-4 flex-shrink-0 text-primary" />
          <Trans>Tap the button below to fill each field. We'll take you to the next one.</Trans>
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="h-11 w-11 flex-shrink-0 p-0"
          aria-label={t`Show all fields`}
          onClick={() => {
            setHasUsedStepper(true);
            setIsFieldsSheetOpen(true);
          }}
        >
          <ListChecksIcon className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold text-foreground">
            {currentField.inserted && <CircleCheckIcon className="h-4 w-4 flex-shrink-0 text-primary" />}
            <span className="truncate">{getFieldLabel(currentField, t)}</span>
          </p>

          <p className="truncate text-muted-foreground text-xs">
            <Trans>
              Field {currentIndex + 1} of {steps.length}
            </Trans>
            {' · '}
            {isRequiredField(currentField) ? <Trans>Required</Trans> : <Trans>Optional</Trans>}
          </p>
        </div>

        <span
          className={cn(
            'flex-shrink-0 rounded-full px-2.5 py-1 font-medium text-xs',
            remainingRequiredCount === 0 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {remainingRequiredCount === 0 ? (
            <Trans>All done</Trans>
          ) : (
            <Plural value={remainingRequiredCount} one="# required left" other="# required left" />
          )}
        </span>
      </div>

      {options && (
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {options.map((option) => (
            <Button
              key={option.index}
              variant="outline"
              className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
              disabled={isSigning}
              aria-pressed={option.isSelected}
              onClick={() => onActivate(option.index)}
            >
              {match({ type: currentField.type, isSelected: option.isSelected })
                .with({ type: FieldType.RADIO, isSelected: true }, () => (
                  <CircleDotIcon className="mr-2 h-5 w-5 flex-shrink-0 text-primary" />
                ))
                .with({ type: FieldType.RADIO }, () => <CircleIcon className="mr-2 h-5 w-5 flex-shrink-0" />)
                .with({ isSelected: true }, () => (
                  <SquareCheckIcon className="mr-2 h-5 w-5 flex-shrink-0 text-primary" />
                ))
                .otherwise(() => (
                  <SquareIcon className="mr-2 h-5 w-5 flex-shrink-0" />
                ))}
              {option.label || <Trans>Option {option.index + 1}</Trans>}
            </Button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-11 w-11 flex-shrink-0 p-0"
          aria-label={t`Previous field`}
          disabled={currentIndex === 0}
          onClick={() => goToField(steps[currentIndex - 1])}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1">
          {remainingRequiredCount === 0 ? (
            <EnvelopeSignerCompleteDialog buttonSize="lg" />
          ) : options ? (
            <p className="text-center text-muted-foreground text-sm">
              {currentField.type === FieldType.RADIO ? (
                <Trans>Choose one option above</Trans>
              ) : (
                <Trans>Tick the options that apply</Trans>
              )}
            </p>
          ) : (
            <Button
              className={cn('h-11 w-full', !hasUsedStepper && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-card')}
              variant={currentField.inserted && currentField.type !== FieldType.TEXT ? 'secondary' : 'default'}
              loading={isSigning}
              onClick={() => onActivate()}
            >
              {getPrimaryActionLabel(currentField)}
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          className="h-11 w-11 flex-shrink-0 p-0"
          aria-label={t`Next field`}
          disabled={currentIndex === steps.length - 1}
          onClick={() => goToField(steps[currentIndex + 1])}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </Button>
      </div>

      <div className="relative h-1 rounded-md bg-muted">
        <motion.div
          layout="size"
          layoutId="document-signing-mobile-stepper-progress-bar"
          className="absolute inset-y-0 left-0 rounded-md bg-primary"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <EnvelopeSignerMobileFieldsSheet
        open={isFieldsSheetOpen}
        onOpenChange={setIsFieldsSheetOpen}
        fields={steps}
        focusedFieldId={focusedFieldId}
        onFieldSelect={(field) => {
          setIsFieldsSheetOpen(false);
          goToField(field);
        }}
      />
    </div>
  );
};

const scrollFocusedFieldIntoView = () => {
  const element = document.getElementById(MOBILE_FOCUSED_FIELD_ELEMENT_ID);

  if (!element) {
    return false;
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return true;
};

const getOrderedSteps = (fields: Field[], envelopeItems: { id: string; order: number }[]) => {
  const itemOrder = new Map(envelopeItems.map((item) => [item.id, item.order]));

  return fields
    .filter((field) => !ZFieldMetaSchema.safeParse(field.fieldMeta).data?.readOnly)
    .sort(
      (a, b) =>
        (itemOrder.get(a.envelopeItemId) ?? 0) - (itemOrder.get(b.envelopeItemId) ?? 0) ||
        a.page - b.page ||
        Number(a.positionY) - Number(b.positionY) ||
        Number(a.positionX) - Number(b.positionX),
    );
};

const findNextUnfilledField = (steps: Field[], fromIndex: number) => {
  const after = [...steps.slice(fromIndex + 1), ...steps.slice(0, fromIndex)];

  return after.find((field) => isFieldUnsignedAndRequired(field)) ?? after.find((field) => !field.inserted);
};

const getFieldOptions = (field: Field) => {
  if (field.type !== FieldType.CHECKBOX && field.type !== FieldType.RADIO) {
    return null;
  }

  const fieldMeta = ZFieldMetaSchema.safeParse(field.fieldMeta).data;
  const values = fieldMeta && 'values' in fieldMeta ? (fieldMeta.values ?? []) : [];

  const selectedIndices =
    field.type === FieldType.CHECKBOX
      ? field.customText
        ? parseCheckboxCustomText(field.customText)
        : []
      : field.inserted
        ? [Number(field.customText)]
        : [];

  return values.map((value, index) => ({
    index,
    label: value.value,
    isSelected: selectedIndices.includes(index),
  }));
};

const isMultiOptionCheckbox = (field: Field) =>
  field.type === FieldType.CHECKBOX && (getFieldOptions(field)?.length ?? 0) > 1;

const getPrimaryActionLabel = (field: Field) =>
  match({ type: field.type, inserted: field.inserted })
    .with({ type: FieldType.SIGNATURE, inserted: false }, () => <Trans>Sign here</Trans>)
    .with({ type: FieldType.SIGNATURE }, () => <Trans>Clear signature</Trans>)
    .with({ type: FieldType.FREE_SIGNATURE, inserted: false }, () => <Trans>Sign here</Trans>)
    .with({ type: FieldType.FREE_SIGNATURE }, () => <Trans>Clear signature</Trans>)
    .with({ type: FieldType.INITIALS, inserted: false }, () => <Trans>Add initials</Trans>)
    .with({ type: FieldType.INITIALS }, () => <Trans>Clear initials</Trans>)
    .with({ type: FieldType.NAME, inserted: false }, () => <Trans>Add name</Trans>)
    .with({ type: FieldType.NAME }, () => <Trans>Clear name</Trans>)
    .with({ type: FieldType.EMAIL, inserted: false }, () => <Trans>Add email</Trans>)
    .with({ type: FieldType.EMAIL }, () => <Trans>Clear email</Trans>)
    .with({ type: FieldType.DATE, inserted: false }, () => <Trans>Add date</Trans>)
    .with({ type: FieldType.DATE }, () => <Trans>Clear date</Trans>)
    .with({ type: FieldType.TEXT, inserted: false }, () => <Trans>Fill in text</Trans>)
    .with({ type: FieldType.TEXT }, () => <Trans>Edit text</Trans>)
    .with({ type: FieldType.NUMBER, inserted: false }, () => <Trans>Enter number</Trans>)
    .with({ type: FieldType.NUMBER }, () => <Trans>Clear number</Trans>)
    .with({ type: FieldType.DROPDOWN, inserted: false }, () => <Trans>Choose an option</Trans>)
    .with({ type: FieldType.DROPDOWN }, () => <Trans>Clear selection</Trans>)
    .otherwise(() => <Trans>Fill in field</Trans>);
