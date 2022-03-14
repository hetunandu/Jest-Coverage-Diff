import * as core from '@actions/core'
import * as github from '@actions/github'
import {execSync} from 'child_process'
import fs from 'fs'
import {CoverageReport} from './Model/CoverageReport'
import {DiffChecker} from './DiffChecker'

async function run(): Promise<void> {
  try {
    const repoName = github.context.repo.repo
    const repoOwner = github.context.repo.owner
    const githubToken = core.getInput('accessToken')
    const fullCoverage = JSON.parse(core.getInput('fullCoverageDiff'))
    const commandToRun = core.getInput('runCommand')
    const delta = Number(core.getInput('delta'))
    const githubClient = github.getOctokit(githubToken)
    const prNumber = github.context.issue.number
    const branchNameBase = github.context.payload.pull_request?.base.ref
    const branchNameHead = github.context.payload.pull_request?.head.ref
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(github.context.payload.pull_request))
    execSync(commandToRun)
    const codeCoverageNew = <CoverageReport>(
      JSON.parse(fs.readFileSync('coverage-summary.json').toString())
    )

    execSync('/usr/bin/git fetch')
    execSync('/usr/bin/git stash')

    execSync(`/usr/bin/git checkout --progress --force ${branchNameBase}`)
    try {
      execSync(commandToRun)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('Error for running', e)
    }

    const codeCoverageOld = <CoverageReport>(
      JSON.parse(fs.readFileSync('coverage-summary.json').toString())
    )
    const currentDirectory = execSync('pwd')
      .toString()
      .trim()
    const diffChecker: DiffChecker = new DiffChecker(
      codeCoverageNew,
      codeCoverageOld
    )
    const messageTitle = `## Test coverage results :test_tube:`
    let messageToPost = `\n
    // Code coverage diff between base branch:${branchNameBase} and head branch: ${branchNameHead} \n`
    const coverageDetails = diffChecker.getCoverageDetails(
      !fullCoverage,
      `${currentDirectory}/`
    )
    if (coverageDetails.length === 0) {
      messageToPost =
        'No changes to code coverage between the base branch and the head branch'
    } else {
      messageToPost +=
        'Status | File | % Stmts | % Branch | % Funcs | % Lines \n -----|-----|---------|----------|---------|------ \n'
      messageToPost += coverageDetails.join('\n')
    }

    const pr = await githubClient.issues.get({ repo: repoName, owner: repoOwner, issue_number: prNumber });
    const prBody = pr.data.body || '';
    const hasCoverageResult = prBody.includes(messageTitle);
    const coverageBody = `${messageTitle}\n<details><summary>${diffChecker.getCoverageSummary()}</summary>\n${messageToPost}</details>`;
    let updateBody = `${prBody}`;
    if(hasCoverageResult) {
      const coverageStarts = prBody.indexOf(messageTitle);
      const bodyWithoutCoverage = prBody.substring(0, coverageStarts);
      updateBody = `${bodyWithoutCoverage}\n${coverageBody}`;
    } else {
      updateBody = `${prBody}\n${coverageBody}`;
    }
    await githubClient.issues.update({
      repo: repoName,
      owner: repoOwner,
      issue_number: prNumber,
      body: updateBody
    })


    // check if the test coverage is falling below delta/tolerance.
    if (diffChecker.checkIfTestCoverageFallsBelowDelta(delta)) {
      messageToPost = `Current PR reduces the test coverage percentage by ${delta} for some tests`
      await githubClient.issues.createComment({
        repo: repoName,
        owner: repoOwner,
        body: messageToPost,
        issue_number: prNumber
      })
      throw Error(messageToPost)
    }
  } catch (error) {
    core.setFailed(error)
  }
}

run()
