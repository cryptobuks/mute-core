import { Observable, Observer, BehaviorSubject, ReplaySubject } from 'rxjs'

import { BroadcastMessage, SendRandomlyMessage, SendToMessage, MessageEmitter, NetworkMessage } from '../network/'
import { Collaborator } from './Collaborator'
const pb = require('./collaborator_pb.js')

export class CollaboratorsService implements MessageEmitter {

  private pseudonym: string

  private joinSubject: ReplaySubject<Collaborator>
  private leaveSubject: ReplaySubject<Collaborator>
  private pseudoSubject: BehaviorSubject<Collaborator | null>

  private msgToBroadcastObservable: Observable<BroadcastMessage>
  private msgToBroadcastObservers: Observer<BroadcastMessage>[] = []

  private msgToSendRandomlyObservable: Observable<SendRandomlyMessage>
  private msgToSendRandomlyObservers: Observer<SendRandomlyMessage>[] = []

  private msgToSendToObservable: Observable<SendToMessage>
  private msgToSendToObservers: Observer<SendToMessage>[] = []

  readonly collaborators: Set<Collaborator>

  constructor () {
    this.collaborators = new Set<Collaborator>()
    this.joinSubject = new ReplaySubject<Collaborator>()
    this.leaveSubject = new ReplaySubject<Collaborator>()
    this.pseudoSubject = new BehaviorSubject<Collaborator | null>(null)

    this.msgToBroadcastObservable = Observable.create((observer) => {
      this.msgToBroadcastObservers.push(observer)
    })

    this.msgToSendRandomlyObservable = Observable.create((observer) => {
      this.msgToSendRandomlyObservers.push(observer)
    })

    this.msgToSendToObservable = Observable.create((observer) => {
      this.msgToSendToObservers.push(observer)
    })
  }

  get onJoin (): Observable<Collaborator> { return this.joinSubject.asObservable() }

  get onLeave (): Observable<Collaborator> { return this.leaveSubject.asObservable() }

  get onPseudo (): Observable<Collaborator | null> { return this.pseudoSubject.asObservable() }

  get onMsgToBroadcast(): Observable<BroadcastMessage> {
    return this.msgToBroadcastObservable
  }

  get onMsgToSendRandomly(): Observable<SendRandomlyMessage> {
    return this.msgToSendRandomlyObservable
  }

  get onMsgToSendTo(): Observable<SendToMessage> {
    return this.msgToSendToObservable
  }

  set leaveSource (source: Observable<void>) {
    source.subscribe(() => {
      this.collaborators.clear()
    })
  }

  set messageSource (source: Observable<NetworkMessage>) {
    source
    .filter((msg: NetworkMessage) => msg.service === this.constructor.name)
    .subscribe((msg: NetworkMessage) => {
      const pbCollaborator = new pb.Collaborator.deserializeBinary(msg.content)
      const collaborator = this.getCollaboratorById(msg.id)
      if (collaborator !== null) {
        const oldPseudo = collaborator.pseudo
        collaborator.pseudo = pbCollaborator.getPseudo()
        if (oldPseudo === null) {
          this.joinSubject.next(collaborator)
        } else {
          this.pseudoSubject.next(collaborator)
        }
      }
    })
  }

  set peerJoinSource (source: Observable<number>) {
    source.subscribe((id: number) => {
      this.emitPseudo(this.pseudonym, id)
      const collab = new Collaborator(id)
      this.collaborators.add(collab)
      this.joinSubject.next(collab)
    })
  }

  set peerLeaveSource (source: Observable<number>) {
    source.subscribe((id: number) => {
      const collab = this.getCollaboratorById(id)
      if (collab !== null && this.collaborators.delete(collab)) {
        this.leaveSubject.next(collab)
      }
    })
  }

  set pseudoSource (source: Observable<String>) {
    source.subscribe((pseudo: string) => {
      this.pseudonym = pseudo
      this.emitPseudo(pseudo)
    })
  }

  emitPseudo (pseudo: string, id?: number): void {
    const collabMsg = new pb.Collaborator()
    collabMsg.setPseudo(pseudo)

    if (id) {
      const msg: SendToMessage = new SendToMessage(this.constructor.name, id, collabMsg.serializeBinary())
      this.msgToSendToObservers.forEach((observer: Observer<SendToMessage>) => {
        observer.next(msg)
      })
    } else {
      const msg: BroadcastMessage = new BroadcastMessage(this.constructor.name, collabMsg.serializeBinary())
      this.msgToBroadcastObservers.forEach((observer: Observer<BroadcastMessage>) => {
        observer.next(msg)
      })
    }
  }

  getCollaboratorById (id: number): Collaborator | null {
    let collab: Collaborator | null = null
    this.collaborators.forEach((value) => {
      if (value.id === id) {
        collab = value
      }
    })
    return collab
  }

}