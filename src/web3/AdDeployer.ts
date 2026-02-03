import {
    createPublicClient,
    http,
    encodeFunctionData,
    type Address,
    type Hash,
    type Hex,
    keccak256,
    encodePacked,
    encodeAbiParameters
} from "viem";
import { baseSepolia, base } from "viem/chains";
import { X402_FACILITATORS, ChainIDBaseSepolia } from "../common/x402_obj";
import { getCurrentUser, isSignedIn, sendEvmTransaction, type EvmAddress } from "@coinbase/cdp-core";
import { initCDP } from "../common/x402_obj";

// AdVault 编译后的 Creation Code (Init Code)
const AD_VAULT_CREATION_CODE = "0x60e060405234801561000f575f5ffd5b50604051610a85380380610a8583398181016040528101906100319190610133565b8273ffffffffffffffffffffffffffffffffffffffff1660808173ffffffffffffffffffffffffffffffffffffffff16815250508173ffffffffffffffffffffffffffffffffffffffff1660a08173ffffffffffffffffffffffffffffffffffffffff16815250508073ffffffffffffffffffffffffffffffffffffffff1660c08173ffffffffffffffffffffffffffffffffffffffff1681525050505050610183565b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f610102826100d9565b9050919050565b610112816100f8565b811461011c575f5ffd5b50565b5f8151905061012d81610109565b92915050565b5f5f5f6060848603121561014a576101496100d5565b5b5f6101578682870161011f565b93505060206101688682870161011f565b92505060406101798682870161011f565b9150509250925092565b60805160a05160c0516108af6101d65f395f8181610169015281816102470152818161031e01526103b801525f818160db015261026b01525f818161028f015281816103f401526104b501526108af5ff3fe608060405234801561000f575f5ffd5b5060043610610055575f3560e01c8063117de2fd146100595780633e413bee146100755780634bde38c814610093578063590e1ae3146100b15780638da5cb5b146100bb575b5f5ffd5b610073600480360381019061006e9190610568565b6100d9565b005b61007d610245565b60405161008a91906105b5565b60405180910390f35b61009b610269565b6040516100a891906105b5565b60405180910390f35b6100b961028d565b005b6100c36104b3565b6040516100d091906105b5565b60405180910390f35b7f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614610167576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161015e9061064e565b60405180910390fd5b7f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff1663a9059cbb83836040518363ffffffff1660e01b81526004016101c292919061067b565b6020604051808303815f875af11580156101de573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061020291906106d7565b610241576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016102389061074c565b60405180910390fd5b5050565b7f000000000000000000000000000000000000000000000000000000000000000081565b7f000000000000000000000000000000000000000000000000000000000000000081565b7f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff161461031b576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610312906107b4565b60405180910390fd5b5f7f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff1660e01b815260040161037591906105b5565b602060405180830381865afa158015610390573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906103b491906107e6565b90507f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff1663a9059cbb7f0000000000000000000000000000000000000000000000000000000000000000836040518363ffffffff1660e01b815260040161043192919061067b565b6020604051808303815f875af115801561044d573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061047191906106d7565b6104b0576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016104a79061085b565b60405180910390fd5b50565b7f000000000000000000000000000000000000000000000000000000000000000081565b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f610504826104db565b9050919050565b610514816104fa565b811461051e575f5ffd5b50565b5f8135905061052f8161050b565b92915050565b5f819050919050565b61054781610535565b8114610551575f5ffd5b50565b5f813590506105628161053e565b92915050565b5f5f6040838503121561057e5761057d6104d7565b5b5f61058b85828601610521565b925050602061059c85828601610554565b9150509250929050565b6105af816104fa565b82525050565b5f6020820190506105c85f8301846105a6565b92915050565b5f82825260208201905092915050565b7f4f6e6c7920706c6174666f726d2063616e20617574686f72697a65207061796f5f8201527f7574000000000000000000000000000000000000000000000000000000000000602082015250565b5f6106386022836105ce565b9150610643826105de565b604082019050919050565b5f6020820190508181035f8301526106658161062c565b9050919050565b61067581610535565b82525050565b5f60408201905061068e5f8301856105a6565b61069b602083018461066c565b9392505050565b5f8115159050919050565b6106b6816106a2565b81146106c0575f5ffd5b50565b5f815190506106d1816106ad565b92915050565b5f602082840312156106ec576106eb6104d7565b5b5f6106f9848285016106c3565b91505092915050565b7f5472616e73666572206661696c656400000000000000000000000000000000005f82015250565b5f610736600f836105ce565b915061074182610702565b602082019050919050565b5f6020820190508181035f8301526107638161072a565b9050919050565b7f4f6e6c79206f776e65722063616e20726566756e6400000000000000000000005f82015250565b5f61079e6015836105ce565b91506107a98261076a565b602082019050919050565b5f6020820190508181035f8301526107cb81610792565b9050919050565b5f815190506107e08161053e565b92915050565b5f602082840312156107fb576107fa6104d7565b5b5f610808848285016107d2565b91505092915050565b7f526566756e64206661696c6564000000000000000000000000000000000000005f82015250565b5f610845600d836105ce565b915061085082610811565b602082019050919050565b5f6020820190508181035f83015261087281610839565b905091905056fea264697066735822122092e85101b214eb1ef71b4241273a48e021ff786d7d71e3d3c4d820461334e95864736f6c63430008210033";

/**
 * AdDeployer - 负责通过智能账户和 Paymaster 部署广告合约
 */
export class AdDeployer {
    /**
     * 估算部署所需的 Gas 费用 (ETH)
     */
    public static async estimateDeployFee(chainId: number): Promise<string> {
        const facilitator = X402_FACILITATORS[chainId];
        const chain = chainId === ChainIDBaseSepolia ? baseSepolia : base;
        const publicClient = createPublicClient({
            chain,
            transport: http(facilitator.paymasterRpc)
        });

        try {
            const gasPrice = await publicClient.getGasPrice();
            // 部署合约大约需要 1,000,000 Gas (这是一个保守的上限，通常实际消耗更少)
            const estimatedGas = 1000000n;
            const feeWei = gasPrice * estimatedGas;
            // 转换为 ETH (保留 6 位小数以便阅读)
            return (Number(feeWei) / 1e18).toFixed(6);
        } catch (e) {
            console.error("Failed to estimate gas:", e);
            return "0.000100"; // 返回一个 Base 网络上的典型保守值
        }
    }


    // 从配置中获取工厂合约地址
    public static getFactoryAddress(chainId: number): Address {
        const facilitator = X402_FACILITATORS[chainId];
        return (facilitator?.adFactory || "0x0000000000000000000000000000000000000000") as Address;
    }

    /**
     * 计算确定性的合约地址 (CREATE2)
     */
    public static computeAdAddress(
        factory: Address,
        owner: Address,
        platform: Address,
        adId: string,
        usdcAddress: Address
    ): Address {
        const salt = keccak256(encodePacked(["string"], [adId]));

        // 构造函数参数编码: constructor(address _owner, address _platform, address _usdc)
        // 注意：Solidity 的 abi.encode 会对 address 进行 32 字节填充，因此使用 encodeAbiParameters
        const constructorArgs = encodeAbiParameters(
            [
                { type: "address", name: "_owner" },
                { type: "address", name: "_platform" },
                { type: "address", name: "_usdc" }
            ],
            [owner, platform, usdcAddress]
        );

        // 创建代码 = 原始代码 + 构造参数
        const initCode = encodePacked(
            ["bytes", "bytes"],
            [AD_VAULT_CREATION_CODE as Hex, constructorArgs]
        );

        const initCodeHash = keccak256(initCode);

        // CREATE2 地址计算: keccak256(0xff + factory + salt + keccak256(initCode))
        const hash = keccak256(
            encodePacked(
                ["bytes1", "address", "bytes32", "bytes32"],
                ["0xff", factory, salt, initCodeHash]
            )
        );

        // 取最后 20 字节作为地址
        return `0x${hash.slice(-40)}` as Address;
    }

    /**
     * 执行合约部署：使用 EOA 私钥本地签名
     * 为了 100% 自主性和去中心化，不使用 CDP Smart Account 接口
     */
    public static async deployAdVault(
        chainId: number,
        platform: Address,
        adId: string
    ): Promise<{ deployHash: Hash; predictedAddress: Address }> {
        const facilitator = X402_FACILITATORS[chainId];
        if (!facilitator) throw new Error("Unsupported chain");

        const salt = keccak256(encodePacked(["string"], [adId]));
        const usdcAddress = facilitator.usdcAddress as Address;
        const factoryAddress = this.getFactoryAddress(chainId);

        await initCDP();
        if (!await isSignedIn()) throw new Error("Not signed in");

        const user = await getCurrentUser();
        const eoa = user?.evmAccountObjects?.[0];
        if (!eoa?.address) throw new Error("EOA account not found");

        const eoaAddress = eoa.address as unknown as EvmAddress;

        const chain = chainId === ChainIDBaseSepolia ? baseSepolia : base;
        const publicClient = createPublicClient({
            chain,
            transport: http(facilitator.paymasterRpc)
        });

        // 1) 调用合约预测地址，确保 100% 准确 (避免 TS 侧 Creation Code 差异)
        const predictedAddress = await publicClient.readContract({
            address: factoryAddress,
            abi: [
                {
                    "inputs": [
                        {"internalType": "address", "name": "_owner", "type": "address"},
                        {"internalType": "address", "name": "_platform", "type": "address"},
                        {"internalType": "address", "name": "_usdc", "type": "address"},
                        {"internalType": "bytes32", "name": "_salt", "type": "bytes32"}
                    ],
                    "name": "computeAddress",
                    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
                    "stateMutability": "view",
                    "type": "function"
                }
            ] as const,
            functionName: "computeAddress",
            args: [eoa.address as Address, platform, usdcAddress, salt]
        } as any) as Address;

        console.log(`[AdDeployer] Predicted AdVault: ${predictedAddress} (Verified by Factory)`);

        // 2) 模拟构建 calldata
        const {request} = await publicClient.simulateContract({
            account: eoa.address as Address,
            address: factoryAddress,
            abi: [
                {
                    "inputs": [
                        {"internalType": "address", "name": "_platform", "type": "address"},
                        {"internalType": "address", "name": "_usdc", "type": "address"},
                        {"internalType": "string", "name": "_adId", "type": "string"},
                        {"internalType": "bytes32", "name": "_salt", "type": "bytes32"}
                    ],
                    "name": "deployAd",
                    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ] as const,
            functionName: "deployAd",
            args: [platform, usdcAddress, adId, salt]
        } as any);

        // 3) 通过 CDP 在浏览器内核签名并发送交易（不导出私钥）
        const network = chainId === 8453 ? "base" : "base-sepolia";
        const tx = await sendEvmTransaction({
            evmAccount: eoaAddress,
            network,
            transaction: {
                to: factoryAddress,
                data: request.data,
                value: request.value ?? 0n,
                chainId,
                type: "eip1559",
            },
        });

        const deployHash = tx.transactionHash as Hash;
        console.log(`[AdDeployer] Deployment Tx Hash: ${deployHash}`);

        // 4) 等待部署确认
        await publicClient.waitForTransactionReceipt({hash: deployHash});

        return {deployHash, predictedAddress};
    }
}
