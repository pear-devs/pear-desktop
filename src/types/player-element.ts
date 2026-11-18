export interface PlayerController {
  onDoubleClick: (() => void) | undefined;
}

export interface PlayerElement extends HTMLElement {
  polymerController: PlayerController;
}
