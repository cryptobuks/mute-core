import { LogootSOperation } from 'mute-structs'
import { Observable, Subject } from 'rxjs'

import { Interval } from './Interval'
import { ReplySyncEvent } from './ReplySyncEvent'
import { RichLogootSOperation } from './RichLogootSOperation'
import { State } from './State'
import { StateVector } from './StateVector'

import { Disposable } from '../Disposable'
import { JoinEvent } from '../network/'

type Key = { id: number, clock: number }

export class SyncService implements Disposable {

  private id: number = -1
  private clock: number = 0
  private richLogootSOps: RichLogootSOperation[] = []
  private vector: StateVector

  private appliedOperationsSubject: Subject<Key>
  private disposeSubject: Subject<void>
  private isReadySubject: Subject<void>
  private localRichLogootSOperationSubject: Subject<RichLogootSOperation>
  private querySyncSubject: Subject<Map<number, number>>
  private remoteLogootSOperationSubject: Subject<LogootSOperation[]>
  private replySyncSubject: Subject<ReplySyncEvent>
  private stateSubject: Subject<State>
  private triggerQuerySyncSubject: Subject<void>

  constructor (id: number) {
    this.id = id
    this.vector = new StateVector()
    this.appliedOperationsSubject = new Subject()
    this.disposeSubject = new Subject<void>()
    this.isReadySubject = new Subject<void>()
    this.localRichLogootSOperationSubject = new Subject()
    this.querySyncSubject = new Subject()
    this.remoteLogootSOperationSubject = new Subject()
    this.replySyncSubject = new Subject()
    this.stateSubject = new Subject()
    this.triggerQuerySyncSubject = new Subject<void>()

    this.initPeriodicQuerySync()
  }

  get onLocalRichLogootSOperation (): Observable<RichLogootSOperation> {
    return this.localRichLogootSOperationSubject.asObservable()
  }

  get onQuerySync (): Observable<Map<number, number>> {
    return this.querySyncSubject.asObservable()
  }

  get onRemoteLogootSOperation (): Observable<LogootSOperation[]> {
    return this.remoteLogootSOperationSubject.asObservable()
  }

  get onReplySync (): Observable<ReplySyncEvent> {
    return this.replySyncSubject.asObservable()
  }

  get onState (): Observable<State> {
    return this.stateSubject.asObservable()
  }

  get state (): State {
    return new State(this.vector.asMap(), this.richLogootSOps)
  }

  set localLogootSOperationSource (source: Observable<LogootSOperation>) {
    source
      .takeUntil(this.disposeSubject)
      .subscribe((logootSOp: LogootSOperation) => {
        const richLogootSOp: RichLogootSOperation =
          new RichLogootSOperation(this.id, this.clock, logootSOp)

        this.updateState(richLogootSOp)

        this.stateSubject.next(this.state)
        this.localRichLogootSOperationSubject.next(richLogootSOp)

        this.clock++
      })
  }

  set remoteQuerySyncSource (source: Observable<Map<number, number>>) {
    source
      .takeUntil(this.disposeSubject)
      .subscribe((vector: Map<number, number>) => {
        const missingRichLogootSOps: RichLogootSOperation[] =
          this.computeMissingOps(vector)
        // TODO: Add sort function to apply LogootSAdd operations before LogootSDel ones

        const missingIntervals: Interval[] =
          this.computeMissingIntervals(vector)

        const replySyncEvent: ReplySyncEvent =
          new ReplySyncEvent(missingRichLogootSOps, missingIntervals)
        this.replySyncSubject.next(replySyncEvent)
      })
  }

  set remoteReplySyncSource (source: Observable<ReplySyncEvent>) {
    source
      .takeUntil(this.disposeSubject)
      .subscribe((replySyncEvent: ReplySyncEvent) => {
        if (replySyncEvent.richLogootSOps.length > 0) {
          this.applyRichLogootSOperations(replySyncEvent.richLogootSOps)
          this.stateSubject.next(this.state)
        }

        replySyncEvent.intervals.forEach((interval: Interval) => {
          this.richLogootSOps
            .filter((richLogootSOp: RichLogootSOperation) => {
              const id: number = richLogootSOp.id
              const clock: number = richLogootSOp.clock
              return interval.id === id && interval.begin <= clock && clock <= interval.end
            })
            .forEach((richLogootSOp: RichLogootSOperation) => {
              this.localRichLogootSOperationSubject.next(richLogootSOp)
            })
        })
      })
  }

  set remoteRichLogootSOperationSource (source: Observable<RichLogootSOperation>) {
    source
      .takeUntil(this.disposeSubject)
      .subscribe((richLogootSOp: RichLogootSOperation) => {
        this.applyRichLogootSOperations([richLogootSOp])
        this.stateSubject.next(this.state)
      })
  }

  private set storedStateSource (source: Observable<State>) {
    source
      .takeUntil(this.disposeSubject)
      .subscribe((state: State) => {
        this.richLogootSOps = []
        this.vector.clear()
        this.applyRichLogootSOperations(state.richLogootSOps)
        this.isReadySubject.next()
      })
  }

  setJoinAndStateSources (joinSource: Observable<JoinEvent>, storedStateSource?: Observable<State>): void {
    let triggerQuerySyncObservable: Observable<JoinEvent> = joinSource
    if (storedStateSource) {
      this.storedStateSource = storedStateSource
      triggerQuerySyncObservable =
        joinSource
          .takeUntil(this.disposeSubject)
          .zip(this.isReadySubject,
            (joinEvent: JoinEvent) => {
              return joinEvent
            }
          )
    }
    triggerQuerySyncObservable
      .take(1)
      .subscribe((joinEvent: JoinEvent) => {
        if (!joinEvent.created) {
          this.querySyncSubject.next(this.vector.asMap())
        }
      })
  }

  private initPeriodicQuerySync (): void {
    this.triggerQuerySyncSubject
      .takeUntil(this.disposeSubject)
      .subscribe(() => {
        this.querySyncSubject.next(this.vector.asMap())
        this.triggerPeriodicQuerySync()
      })

    this.triggerPeriodicQuerySync()
  }

  private triggerPeriodicQuerySync (): void {
    const defaultTime = 10000
    const max = defaultTime / 2
    const min = - max
    const random = Math.floor(Math.random() * 2 * max) + min // Compute a random number between [0, 10000] then shift interval to [-5000, 5000]
    setTimeout(() => {
      this.triggerQuerySyncSubject.next()
    }, defaultTime + random)
  }

  dispose (): void {
    this.appliedOperationsSubject.complete()
    this.disposeSubject.next()
    this.disposeSubject.complete()
    this.isReadySubject.complete()
    this.localRichLogootSOperationSubject.complete()
    this.querySyncSubject.complete()
    this.remoteLogootSOperationSubject.complete()
    this.replySyncSubject.complete()
    this.stateSubject.complete()
  }

  private applyRichLogootSOperations (richLogootSOps: RichLogootSOperation[]): void {
    // Keep only new operations
    const newRichLogootSOps: RichLogootSOperation[] =
      richLogootSOps.filter((richLogootSOp: RichLogootSOperation) => {
        const id: number = richLogootSOp.id
        const clock: number = richLogootSOp.clock
        return !this.vector.isAlreadyDelivered(id, clock)
      })

    if (newRichLogootSOps.length > 0) {
      const logootSOperations: LogootSOperation[] = []
      newRichLogootSOps
        .forEach((richLogootSOp) => {
          const id: number = richLogootSOp.id
          const clock: number = richLogootSOp.clock
          if (this.vector.isDeliverable(id, clock)) {
            this.updateState(richLogootSOp)
            logootSOperations.push(richLogootSOp.logootSOp)
            // Notify that the operation has been delivered
            this.appliedOperationsSubject.next({ id , clock })
          } else {
            // Deliver operation once the previous one will be applied
            console.log('SyncService: Buffering operation: ', { id, clock })
            this.appliedOperationsSubject
              .filter(({ id, clock}: Key) => {
                return richLogootSOp.id === id && richLogootSOp.clock === (clock + 1)
              })
              .take(1)
              .subscribe(() => {
                console.log('SyncService: Delivering operation: ', { id, clock })
                if (!this.vector.isAlreadyDelivered(id, clock)) {
                  this.applyRichLogootSOperations([richLogootSOp])
                }
              })
          }
        })

      this.remoteLogootSOperationSubject.next(logootSOperations)
    }
  }

  private updateState (richLogootSOp: RichLogootSOperation): void {
    console.assert(this.vector.isDeliverable(richLogootSOp.id, richLogootSOp.clock))
    this.vector.set(richLogootSOp.id, richLogootSOp.clock)
    this.richLogootSOps.push(richLogootSOp)
  }

  computeMissingIntervals (vector: StateVector): Interval[] {
    const missingIntervals: Interval[] = []
    vector.forEach((clock: number, id: number) => {
      const v = this.vector.get(id)
      if (v === undefined) {
        const begin = 0
        const end: number = clock
        missingIntervals.push( new Interval(id, begin, end))
      } else if (v < clock) {
        const begin: number = v + 1
        const end: number = clock
        missingIntervals.push( new Interval(id, begin, end))
      }
    })

    return missingIntervals
  }

  computeMissingOps (vector: Map<number, number>): RichLogootSOperation[] {
    return this.richLogootSOps
      .filter((richLogootSOperation: RichLogootSOperation) => {
        const id: number = richLogootSOperation.id
        const clock: number = richLogootSOperation.clock
        const v = vector.get(id)
        return v === undefined ? true : v < clock ? true : false
      })
  }
}
