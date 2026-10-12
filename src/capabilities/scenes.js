// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+): what a scene can ask a robot to do.
//
// Each key is declared in the manifest `scene_actions` field; index.js
// registers every entry with `gladys.onSceneAction(key, ...)`. The rules:
//   - `fields` arrive resolved; `device` is the chosen Gladys device
//     external_id (a `"source": "devices"` select);
//   - a robot that cannot do it (not advertised by the cloud) is an OUTPUT,
//     `sent: false`, not a failure: a scene action is never a condition, the
//     scene author gates on the output;
//   - a cloud error throws: that action fails, the scene continues;
//   - never fire a scene event from here (a scene bound to it would loop).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { INTERFACE } from '../beatbot/const.js';

const logger = createLogger({ name: 'scenes' });

const actionFor = (interfaceInfo) =>
  async function sceneAction(service, { fields }) {
    logger.info(`Scene action ${interfaceInfo} <- ${fields.device}`);
    return { sent: await service.runAction(fields.device, interfaceInfo) };
  };

export const SCENE_ACTIONS = {
  start_cleaning: actionFor(INTERFACE.START),
  pause_cleaning: actionFor(INTERFACE.PAUSE),
  return_to_base: actionFor(INTERFACE.RETURN_TO_BASE),
  async set_cleaning_mode(service, { fields }) {
    logger.info(`Scene action set_cleaning_mode <- ${fields.device} = ${fields.mode}`);
    return { sent: await service.runWorkMode(fields.device, fields.mode ?? '') };
  },
};
