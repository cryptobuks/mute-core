import { Observable, Observer } from 'rxjs'

import { BroadcastMessage } from './BroadcastMessage'
import { SendRandomlyMessage } from './SendRandomlyMessage'
import { SendToMessage } from './SendToMessage'

export interface MessageEmitter {
  readonly onMsgToBroadcast: Observable<BroadcastMessage>
  readonly onMsgToSendTo: Observable<SendRandomlyMessage>
  readonly onMsgToSendRandomly: Observable<SendToMessage>
}