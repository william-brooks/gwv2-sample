import * as anchor from "@project-serum/anchor";
import {
  AdminService, airdrop, findGatewayToken,
  GatekeeperAccount,
  GatekeeperKeyFlags,
  GatekeeperService,
  NetworkAccount,
  NetworkService,
  PassState
} from "@identity.com/gateway-solana-client";
import {ExtendedCluster} from "@identity.com/gateway-solana-client/dist/lib/connection";

const {Keypair} = anchor.web3;

const CLUSTER: ExtendedCluster = 'localnet';

(async () => {
  // The guardian authority
  const guardianAuthority = Keypair.generate();
  const networkAuthority = Keypair.generate();
  const gatekeeperAuthority = Keypair.generate();
  const limitedGatekeeperAuthority = Keypair.generate(); // used to add a limited access key on the gatekeeper

  console.log("/* === SETUP NETWORK : START === */");
  const adminService = await AdminService.build(networkAuthority.publicKey, {
    clusterType: CLUSTER,
    wallet: new anchor.Wallet(guardianAuthority)
  });

  await airdrop(adminService.getConnection(), guardianAuthority.publicKey);

  let network: NetworkAccount | null;
  network = await adminService.getNetworkAccount();
  if (!network) {
    await adminService.createNetwork().withPartialSigners(networkAuthority).rpc();
    network = await adminService.getNetworkAccount();
  }

  console.log("/* === SETUP NETWORK : END === */");

  console.log("/* === SETUP GATEKEEPER : START === */");
  let gatekeeper: GatekeeperAccount | null;
  const [gatekeeperPda] = await NetworkService.createGatekeeperAddress(gatekeeperAuthority.publicKey, networkAuthority.publicKey);
  const [stakingAccountPda] = await NetworkService.createStakingAddress(networkAuthority.publicKey);

  const networkService = await NetworkService.build(
    gatekeeperAuthority.publicKey,
    gatekeeperPda,
    {
      clusterType: CLUSTER,
      wallet: new anchor.Wallet(gatekeeperAuthority)
    })

  await airdrop(networkService.getConnection(), gatekeeperAuthority.publicKey);

  gatekeeper = await networkService.getGatekeeperAccount();

  if (!gatekeeper) {
    await networkService
      .createGatekeeper(networkAuthority.publicKey, stakingAccountPda)
      .withPartialSigners().rpc();

    gatekeeper = await networkService.getGatekeeperAccount();
  }
  console.log("/* === SETUP GATEKEEPER : END === */");

  console.log("* === SETUP ADDITIONAL KEY ON GK : START === */");

  // Add additional 'limited' (issue & freeze) gatekeeper account
  await networkService
    .updateGatekeeper({
      authKeys: {
        add: [
          {
            key: limitedGatekeeperAuthority.publicKey,
            flags: GatekeeperKeyFlags.ISSUE | GatekeeperKeyFlags.FREEZE
          }
        ],
        remove: []
      },
      tokenFees: {add: [], remove: []},
      authThreshold: 1
    }, stakingAccountPda, gatekeeperAuthority.publicKey)
    .withPartialSigners(gatekeeperAuthority)
    .rpc();

  console.log("/* === SETUP ADDITIONAL KEY ON GK : END === */");

  await airdrop(networkService.getConnection(), limitedGatekeeperAuthority.publicKey);


  console.log("/* === PASS ISSUANCE  : START === */");
  const subject = Keypair.generate();
  const gatekeeperService = await GatekeeperService.build(networkAuthority.publicKey, gatekeeperPda, {
    clusterType: CLUSTER,
    wallet: new anchor.Wallet(limitedGatekeeperAuthority) // using the "limited" gatekeeper
  });
  const passAccount = await GatekeeperService.createPassAddress(subject.publicKey, networkAuthority.publicKey);

  // Find
  const token = await findGatewayToken(adminService.getConnection(), networkAuthority.publicKey, subject.publicKey);
  console.log(token);

  // issue
  await gatekeeperService.issue(passAccount, subject.publicKey).rpc();

  console.log("/* === PASS ISSUANCE  : END === */");

  // freeze
  await gatekeeperService.setState(PassState.Frozen, passAccount).rpc();

  // revoke (fails here)
  await gatekeeperService.setState(PassState.Revoked, passAccount).rpc();

})().catch(console.log);