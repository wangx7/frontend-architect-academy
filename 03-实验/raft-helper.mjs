export class RaftNode {
  constructor(id, cluster, initialLog = []) {
    this.id = id
    this.cluster = cluster
    this.role = 'Follower'
    this.currentTerm = 1
    this.votedFor = null
    this.log = [...initialLog]
  }
  getLastLogMeta() {
    if (this.log.length === 0) return { lastLogTerm: 0, lastLogIndex: 0 }
    return { lastLogTerm: this.log[this.log.length - 1].term, lastLogIndex: this.log.length }
  }
  isLogUpToDate(candLastTerm, candLastIndex) {
    const { lastLogTerm, lastLogIndex } = this.getLastLogMeta()
    if (candLastTerm !== lastLogTerm) return candLastTerm > lastLogTerm
    return candLastIndex >= lastLogIndex
  }
  startElection() {
    this.role = 'Candidate'
    this.currentTerm += 1
    this.votedFor = this.id
    let votes = 1
    const { lastLogTerm, lastLogIndex } = this.getLastLogMeta()
    for (const peer of this.cluster.getReachablePeers(this.id)) {
      if (peer.onRequestVote(this.id, this.currentTerm, lastLogTerm, lastLogIndex)) votes++
    }
    const quorum = Math.floor(this.cluster.nodes.length / 2) + 1
    if (votes >= quorum) {
      this.role = 'Leader'
      return { elected: true, term: this.currentTerm, votes, leader: this.id }
    }
    this.role = 'Follower'
    return { elected: false, term: this.currentTerm, votes, leader: null }
  }
  onRequestVote(candId, candTerm, candLastTerm, candLastIndex) {
    if (candTerm > this.currentTerm) {
      this.currentTerm = candTerm
      this.role = 'Follower'
      this.votedFor = null
    }
    if (candTerm < this.currentTerm) return false
    const available = this.votedFor === null || this.votedFor === candId
    if (available && this.isLogUpToDate(candLastTerm, candLastIndex)) {
      this.votedFor = candId
      return true
    }
    return false
  }
  tryReplicateCommand(cmd) {
    if (this.role !== 'Leader') return { committed: false }
    const reachable = [this, ...this.cluster.getReachablePeers(this.id)]
    const quorum = Math.floor(this.cluster.nodes.length / 2) + 1
    for (const peer of reachable) {
      if (peer.currentTerm > this.currentTerm) {
        this.currentTerm = peer.currentTerm
        this.role = 'Follower'
        this.votedFor = null
        return { committed: false }
      }
    }
    if (reachable.length < quorum) return { committed: false, acks: reachable.length }
    const entry = { term: this.currentTerm, cmd }
    reachable.forEach(n => n.log.push(entry))
    return { committed: true, acks: reachable.length, entry }
  }
}

export class RaftCluster {
  constructor(nodeConfigs) {
    this.partitionGroups = null
    this.nodes = nodeConfigs.map(cfg => new RaftNode(cfg.id, this, cfg.log))
  }
  getNode(id) { return this.nodes.find(n => n.id === id) }
  getReachablePeers(fromId) {
    return this.nodes.filter(n => n.id !== fromId && this.canCommunicate(fromId, n.id))
  }
  canCommunicate(a, b) {
    if (!this.partitionGroups) return true
    const gA = this.partitionGroups.find(g => g.includes(a))
    const gB = this.partitionGroups.find(g => g.includes(b))
    return gA === gB
  }
}
