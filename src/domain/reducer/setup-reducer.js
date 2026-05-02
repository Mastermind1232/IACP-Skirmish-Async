export const setupReducerHandlers = {
  MapTypeChosen(state, payload) {
    return { ...state, mapType: payload.mapType };
  },

  MapConfirmed(state, payload) {
    return { ...state, confirmedMapId: payload.mapId };
  },

  DraftRandomStarted(state) {
    return { ...state, draftRandomStarted: true };
  },

  FigurePlaced(state, payload) {
    const figurePositions = structuredClone(state.figurePositions || {});
    const playerPositions = figurePositions[payload.playerNum] || {};
    playerPositions[payload.figureKey] = payload.coord;
    figurePositions[payload.playerNum] = playerPositions;
    return { ...state, figurePositions };
  },

  AttachmentPlaced(state, payload) {
    const dcAttachments = { ...(state.dcAttachments || {}) };
    const attachments = [...(dcAttachments[payload.dcName] || [])];
    attachments.push(payload.attachmentName);
    dcAttachments[payload.dcName] = attachments;
    return { ...state, dcAttachments };
  },
};
