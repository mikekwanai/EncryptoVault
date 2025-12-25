import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedVault = await deploy("EncryptoVault", {
    from: deployer,
    log: true,
  });

  console.log(`EncryptoVault contract: `, deployedVault.address);
};
export default func;
func.id = "deploy_encrypto_vault"; // id required to prevent reexecution
func.tags = ["EncryptoVault"];
