import { ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
import { isRequiredField } from '@documenso/lib/utils/advanced-fields-helpers';
import { cn } from '@documenso/ui/lib/utils';
import { FRIENDLY_FIELD_TYPE } from '@documenso/ui/primitives/document-flow/types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@documenso/ui/primitives/sheet';
import { Trans, useLingui } from '@lingui/react/macro';
import { type Field, FieldType } from '@prisma/client';
import {
  CalendarIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  HashIcon,
  MailIcon,
  SignatureIcon,
  SquareCheckIcon,
  TextCursorInputIcon,
  TypeIcon,
  UserIcon,
} from 'lucide-react';
import { match } from 'ts-pattern';

import { useEmbedSigningContext } from '~/components/embed/embed-signing-context';

import { BrandingLogo } from '../branding-logo';
import EnvelopeSignerForm from './envelope-signer-form';

export type EnvelopeSignerMobileFieldsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: Field[];
  focusedFieldId: number | null;
  onFieldSelect: (field: Field) => void;
};

export const EnvelopeSignerMobileFieldsSheet = ({
  open,
  onOpenChange,
  fields,
  focusedFieldId,
  onFieldSelect,
}: EnvelopeSignerMobileFieldsSheetProps) => {
  const { t } = useLingui();
  const { hidePoweredBy = true } = useEmbedSigningContext() || {};

  const filledCount = fields.filter((field) => field.inserted).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent position="bottom" size="content" className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-4">
        <SheetHeader className="text-left">
          <SheetTitle>
            <Trans>Fields to fill</Trans>
          </SheetTitle>
          <SheetDescription>
            <Trans>
              {filledCount} of {fields.length} filled
            </Trans>
          </SheetDescription>
        </SheetHeader>

        <ul className="mt-4 space-y-2">
          {fields.map((field) => {
            const FieldIcon = getFieldIcon(field.type);

            return (
              <li key={field.id}>
                <button
                  type="button"
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left',
                    field.id === focusedFieldId && 'border-primary bg-primary/5',
                  )}
                  onClick={() => onFieldSelect(field)}
                >
                  <FieldIcon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground text-sm">
                      {getFieldLabel(field, t)}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      <Trans>Page {field.page}</Trans>
                      {' · '}
                      {isRequiredField(field) ? <Trans>Required</Trans> : <Trans>Optional</Trans>}
                    </span>
                  </span>

                  {field.inserted ? (
                    <CircleCheckIcon className="h-5 w-5 flex-shrink-0 text-primary" aria-label={t`Filled`} />
                  ) : (
                    <CircleIcon className="h-5 w-5 flex-shrink-0 text-muted-foreground/50" aria-label={t`Not filled`} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-border border-t pt-4">
          <h3 className="mb-3 font-semibold text-foreground text-sm">
            <Trans>Your details</Trans>
          </h3>

          <EnvelopeSignerForm />
        </div>

        {!hidePoweredBy && (
          <div className="mt-4 inline-block rounded bg-primary px-2 py-1 font-medium text-primary-foreground text-xs opacity-60">
            <span>
              <Trans>Powered by</Trans>
            </span>
            <BrandingLogo className="ml-2 inline-block h-[14px]" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export const getFieldLabel = (field: Field, t: ReturnType<typeof useLingui>['t']) => {
  const label = ZFieldMetaSchema.safeParse(field.fieldMeta).data?.label;

  return label || t(FRIENDLY_FIELD_TYPE[field.type]);
};

const getFieldIcon = (type: FieldType) =>
  match(type)
    .with(FieldType.SIGNATURE, FieldType.FREE_SIGNATURE, () => SignatureIcon)
    .with(FieldType.INITIALS, () => TypeIcon)
    .with(FieldType.NAME, () => UserIcon)
    .with(FieldType.EMAIL, () => MailIcon)
    .with(FieldType.DATE, () => CalendarIcon)
    .with(FieldType.TEXT, () => TextCursorInputIcon)
    .with(FieldType.NUMBER, () => HashIcon)
    .with(FieldType.RADIO, () => CircleDotIcon)
    .with(FieldType.CHECKBOX, () => SquareCheckIcon)
    .with(FieldType.DROPDOWN, () => ChevronDownIcon)
    .exhaustive();
