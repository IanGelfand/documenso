import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { usePageRenderer } from '@documenso/lib/client-only/hooks/use-page-renderer';
import {
  type PageRenderData,
  useCurrentEnvelopeRender,
} from '@documenso/lib/client-only/providers/envelope-render-provider';
import type { TEnvelope } from '@documenso/lib/types/envelope';
import { ZFullFieldSchema } from '@documenso/lib/types/field';
import { renderStaticContents } from '@documenso/lib/universal/content-renderer/render-static-contents';
import {
  createFieldCanvasStyleCache,
  type FieldCanvasStyleCache,
} from '@documenso/lib/universal/field-renderer/field-canvas-style';
import { createSpinner } from '@documenso/lib/universal/field-renderer/field-generic-items';
import { renderField } from '@documenso/lib/universal/field-renderer/render-field';
import { isFieldUnsignedAndRequired } from '@documenso/lib/utils/advanced-fields-helpers';
import { areContentsImprinted } from '@documenso/lib/utils/envelope';
import { getClientSideFieldTranslations } from '@documenso/lib/utils/fields';
import { EnvelopeRecipientFieldTooltip } from '@documenso/ui/components/document/envelope-recipient-field-tooltip';
import { EnvelopeFieldToolTip } from '@documenso/ui/components/field/envelope-field-tooltip';
import { Trans, useLingui } from '@lingui/react/macro';
import { type Field, type Recipient, RecipientRole, type Signature, SigningStatus } from '@prisma/client';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useMemo, useRef } from 'react';

import { useRequiredEnvelopeSigningContext } from '../document-signing/envelope-signing-provider';
import { useEnvelopeFieldActivation } from './use-envelope-field-activation';

export const MOBILE_FOCUSED_FIELD_ELEMENT_ID = 'mobile-focused-field';

type GenericLocalField = TEnvelope['fields'][number] & {
  recipient: Pick<Recipient, 'id' | 'name' | 'email' | 'signingStatus'>;
};

export const EnvelopeSignerPageRenderer = ({ pageData }: { pageData: PageRenderData }) => {
  const { i18n } = useLingui();
  const { currentEnvelopeItem, contentImages, setRenderError } = useCurrentEnvelopeRender();
  const analytics = useAnalytics();
  const activateField = useEnvelopeFieldActivation();

  const {
    envelopeData,
    recipient,
    recipientFields,
    recipientFieldsRemaining,
    showPendingFieldTooltip,
    selectedAssistantRecipientFields,
    selectedAssistantRecipient,
    focusedFieldId,
    setFocusedFieldId,
  } = useRequiredEnvelopeSigningContext();

  const cachedRenderFields = useRef<Map<number, Field & { signature?: Signature | null }>>(new Map());
  const prevShowPendingFieldTooltip = useRef(showPendingFieldTooltip);

  const { stage, pageLayer, konvaContainer, unscaledViewport } = usePageRenderer(
    ({ stage, pageLayer }) => createPageCanvas(stage, pageLayer),
    pageData,
  );

  const { scale, pageNumber } = pageData;

  const { envelope } = envelopeData;

  const localPageFields = useMemo(() => {
    let fieldsToRender = recipientFields;

    if (recipient.role === RecipientRole.ASSISTANT) {
      fieldsToRender = selectedAssistantRecipientFields;
    }

    return fieldsToRender.filter(
      (field) => field.page === pageNumber && field.envelopeItemId === currentEnvelopeItem?.id,
    );
  }, [recipientFields, selectedAssistantRecipientFields, pageNumber, currentEnvelopeItem?.id]);

  /**
   * Returns fields that have been fully signed by other recipients for this specific
   * page.
   */
  const localPageOtherRecipientFields = useMemo((): GenericLocalField[] => {
    const signedRecipients = envelope.recipients.filter(
      (recipient) => recipient.signingStatus === SigningStatus.SIGNED,
    );

    return signedRecipients.flatMap((recipient) => {
      return recipient.fields
        .filter(
          (field) =>
            field.page === pageNumber &&
            field.envelopeItemId === currentEnvelopeItem?.id &&
            (field.inserted || field.fieldMeta?.readOnly),
        )
        .map((field) => ({
          ...field,
          recipient: {
            id: recipient.id,
            name: recipient.name,
            email: recipient.email,
            signingStatus: recipient.signingStatus,
            role: recipient.role,
          },
        }));
    });
  }, [envelope.recipients, pageNumber, currentEnvelopeItem?.id]);

  const unsafeRenderFieldOnLayer = (
    unparsedField: Field & { signature?: Signature | null },
    fieldCanvasStyleCache: FieldCanvasStyleCache,
  ) => {
    if (!pageLayer.current) {
      console.error('Layer not loaded yet');
      return;
    }

    const fieldToRender = ZFullFieldSchema.parse(unparsedField);

    const isValidating = showPendingFieldTooltip && isFieldUnsignedAndRequired(fieldToRender);

    const color = fieldToRender.fieldMeta?.readOnly ? 'readOnly' : isValidating ? 'orange' : 'green';

    const { fieldGroup } = renderField({
      scale,
      pageLayer: pageLayer.current,
      field: {
        renderId: fieldToRender.id.toString(),
        ...fieldToRender,
        width: Number(fieldToRender.width),
        height: Number(fieldToRender.height),
        positionX: Number(fieldToRender.positionX),
        positionY: Number(fieldToRender.positionY),
        isValidating,
        signature: unparsedField.signature,
      },
      translations: getClientSideFieldTranslations(i18n),
      pageWidth: unscaledViewport.width,
      pageHeight: unscaledViewport.height,
      color,
      mode: 'sign',
      fieldCanvasStyleCache,
    });

    const handleFieldGroupClick = (e: KonvaEventObject<Event>) => {
      const currentTarget = e.currentTarget as Konva.Group;
      const target = e.target as Konva.Shape;

      const fieldRect = fieldGroup.findOne('.field-rect');
      const fieldWidth = fieldRect ? fieldRect.width() : fieldGroup.width();
      const fieldHeight = fieldRect ? fieldRect.height() : fieldGroup.height();

      const foundField = localPageFields.find((f) => f.id === unparsedField.id);
      const foundLoadingGroup = currentTarget.findOne('.loading-spinner-group');

      if (!foundField || foundLoadingGroup || foundField.fieldMeta?.readOnly) {
        return;
      }

      setFocusedFieldId(foundField.id);

      const loadingSpinnerGroup = createSpinner({
        fieldWidth,
        fieldHeight,
      });

      activateField({
        field: foundField,
        optionIndex: Number(target.getAttr('internalCheckboxIndex') ?? target.getAttr('internalRadioIndex')),
        onSigningStart: () => fieldGroup.add(loadingSpinnerGroup),
        onSigningEnd: () => loadingSpinnerGroup.destroy(),
      });
    };

    fieldGroup.off('pointerdown');
    fieldGroup.on('pointerdown', handleFieldGroupClick);
  };

  const renderFieldOnLayer = (
    unparsedField: Field & { signature?: Signature | null },
    fieldCanvasStyleCache: FieldCanvasStyleCache,
  ) => {
    try {
      unsafeRenderFieldOnLayer(unparsedField, fieldCanvasStyleCache);
    } catch (err) {
      console.error(err);

      analytics.captureException(err, {
        source: 'signing',
        location: 'page_render',
        recipientId: recipient.id,
        envelopeId: envelope.id,
      });

      setRenderError(true);
    }
  };

  const renderFields = () => {
    if (!pageLayer.current) {
      console.error('Layer not loaded yet');
      return;
    }

    const fieldCanvasStyleCache = createFieldCanvasStyleCache();

    // Render current recipient fields which have changed or are not currently rendered.
    for (const field of localPageFields) {
      const existingCachedField = cachedRenderFields.current.get(field.id);
      const isFieldCurrentlyRendered = pageLayer.current.findOne(`#${field.id}`);

      if (
        !isFieldCurrentlyRendered ||
        !existingCachedField ||
        existingCachedField.inserted !== field.inserted ||
        existingCachedField.customText !== field.customText
      ) {
        renderFieldOnLayer(field, fieldCanvasStyleCache);
        cachedRenderFields.current.set(field.id, field);
      }
    }

    // Render other recipient signed and inserted fields.
    for (const field of localPageOtherRecipientFields) {
      try {
        const { fieldGroup } = renderField({
          scale,
          pageLayer: pageLayer.current,
          field: {
            renderId: field.id.toString(),
            ...field,
            width: Number(field.width),
            height: Number(field.height),
            positionX: Number(field.positionX),
            positionY: Number(field.positionY),
            fieldMeta: field.fieldMeta,
          },
          translations: getClientSideFieldTranslations(i18n),
          pageWidth: unscaledViewport.width,
          pageHeight: unscaledViewport.height,
          color: 'readOnly',
          editable: false,
          mode: 'sign',
          fieldCanvasStyleCache,
        });

        // Other-recipient fields are display-only — they have no click handlers
        // and shouldn't intercept events meant for the current recipient's
        // fields. Disable hit detection on the entire group.
        fieldGroup.listening(false);
      } catch (err) {
        console.error('Unable to render one or more fields belonging to other recipients.');
        console.error(err);
      }
    }
  };

  // Direct templates are signed without being sent, so their contents are not
  // imprinted in the PDF yet and must still be rendered.
  const renderContents = () => {
    if (!pageLayer.current || areContentsImprinted(envelope.status)) {
      return;
    }

    try {
      renderStaticContents({
        contents: envelope.contents.filter(
          (content) => content.contentMeta.page === pageNumber && content.envelopeItemId === currentEnvelopeItem?.id,
        ),
        pageLayer: pageLayer.current,
        pageWidth: unscaledViewport.width,
        pageHeight: unscaledViewport.height,
        scale,
        mode: 'sign',
        images: contentImages.images,
      });
    } catch (err) {
      console.error(err);
      setRenderError(true);
    }
  };

  /**
   * Initialize the Konva page canvas and all fields and interactions.
   */
  const createPageCanvas = (currentStage: Konva.Stage, currentPageLayer: Konva.Layer) => {
    renderContents();
    renderFields();
    currentPageLayer.batchDraw();
  };

  /**
   * Render fields when they are changed or inserted.
   */
  useEffect(() => {
    if (!pageLayer.current || !stage.current) {
      return;
    }

    // When the pending-field tooltip toggles, all unsigned required fields need to
    // be re-rendered so their stroke color updates (green <-> orange). Field-level
    // properties like `inserted` and `customText` haven't changed, so the cache
    // would otherwise skip them — clear it to force a fresh render.
    if (prevShowPendingFieldTooltip.current !== showPendingFieldTooltip) {
      cachedRenderFields.current.clear();
      prevShowPendingFieldTooltip.current = showPendingFieldTooltip;
    }

    renderFields();

    pageLayer.current.batchDraw();
  }, [localPageFields, showPendingFieldTooltip]);

  /**
   * Rerender the whole page if the selected assistant recipient changes.
   */
  useEffect(() => {
    if (!pageLayer.current || !stage.current) {
      return;
    }

    // Rerender the whole page.
    pageLayer.current.destroyChildren();
    cachedRenderFields.current.clear();

    renderContents();
    renderFields();

    pageLayer.current.batchDraw();
  }, [selectedAssistantRecipient]);

  const focusedPageField = localPageFields.find((field) => field.id === focusedFieldId);

  if (!currentEnvelopeItem) {
    return null;
  }

  return (
    <>
      {showPendingFieldTooltip &&
        recipientFieldsRemaining.length > 0 &&
        recipientFieldsRemaining[0]?.envelopeItemId === currentEnvelopeItem?.id &&
        recipientFieldsRemaining[0]?.page === pageNumber && (
          <EnvelopeFieldToolTip
            key={recipientFieldsRemaining[0].id}
            field={recipientFieldsRemaining[0]}
            color="warning"
          >
            <Trans>Click to insert field</Trans>
          </EnvelopeFieldToolTip>
        )}

      {localPageOtherRecipientFields.map((field) => (
        <EnvelopeRecipientFieldTooltip
          key={field.id}
          field={field}
          showFieldStatus={true}
          showRecipientTooltip={true}
        />
      ))}

      {focusedPageField && (
        <div
          id={MOBILE_FOCUSED_FIELD_ELEMENT_ID}
          aria-hidden="true"
          className="pointer-events-none absolute z-20 rounded-sm ring-2 ring-primary ring-offset-2 ring-offset-background lg:hidden"
          style={{
            left: `${Number(focusedPageField.positionX)}%`,
            top: `${Number(focusedPageField.positionY)}%`,
            width: `${Number(focusedPageField.width)}%`,
            height: `${Number(focusedPageField.height)}%`,
          }}
        />
      )}

      {/* The element Konva will inject it's canvas into. */}
      <div className="konva-container absolute inset-0 z-10 w-full" ref={konvaContainer}></div>
    </>
  );
};
