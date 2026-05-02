export const SETUP_EVENTS = {
  MapTypeChosen: 'MapTypeChosen',
  MapConfirmed: 'MapConfirmed',
  DraftRandomStarted: 'DraftRandomStarted',
  FigurePlaced: 'FigurePlaced',
  AttachmentPlaced: 'AttachmentPlaced',
};

export const SETUP_EVENT_SCHEMAS = {
  MapTypeChosen: { required: ['mapType'] },
  MapConfirmed: { required: ['mapId'] },
  DraftRandomStarted: { required: [] },
  FigurePlaced: { required: ['figureKey', 'coord', 'playerNum'] },
  AttachmentPlaced: { required: ['attachmentName', 'dcName'] },
};
